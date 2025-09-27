from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, String, Boolean, Integer, ForeignKey, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from .settings import settings

APP_TITLE = settings.app_title
DATABASE_URL = settings.database_url


class Base(DeclarativeBase):
    pass


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    author: Mapped[str] = mapped_column(String(64))  # sender name/number
    body: Mapped[str] = mapped_column(String(280))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)
    # new fields for classic phone mailboxes
    box: Mapped[str] = mapped_column(String(16), default="inbox")  # inbox|sent|drafts
    recipient: Mapped[str | None] = mapped_column(String(64), default=None)  # for sent/drafts
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    sender_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), default=None)
    recipient_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), default=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    handle: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _ensure_schema() -> None:
    """Best-effort SQLite migrations to add new columns if missing."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.connect() as conn:
        # fetch existing columns
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(messages)").fetchall()]
        # Add columns if they don't exist
        if "box" not in cols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN box TEXT DEFAULT 'inbox'")
        if "recipient" not in cols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN recipient TEXT")
        if "read" not in cols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN read BOOLEAN DEFAULT 0")
        if "sender_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN sender_id INTEGER")
        if "recipient_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN recipient_id INTEGER")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class MessageOut(BaseModel):
    id: int
    author: str
    body: str
    created_at: datetime
    box: str | None = None
    recipient: str | None = None
    read: bool | None = None

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    author: str = Field(..., max_length=32, min_length=1)
    body: str = Field(..., max_length=280, min_length=1)


def create_app() -> FastAPI:
    app = FastAPI(title=APP_TITLE)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list(),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret)

    # Security hardening
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list())
    if settings.enforce_https:
        app.add_middleware(HTTPSRedirectMiddleware)

    base_dir = Path(__file__).resolve().parent
    static_path = base_dir / "static"
    templates_path = base_dir / "templates"

    app.mount("/static", StaticFiles(directory=static_path), name="static")
    # Dev-only mount to serve reference.png from repo root for overlay comparisons
    if settings.env != "production":
        project_root = base_dir.parent
        app.mount("/assets", StaticFiles(directory=project_root), name="assets")
    templates = Jinja2Templates(directory=str(templates_path))

    @app.get("/", response_class=HTMLResponse)
    def read_index(request: Request) -> HTMLResponse:
        return templates.TemplateResponse("index.html", {"request": request, "title": APP_TITLE})

    # Health and readiness probes
    @app.get("/healthz", tags=["health"])  # liveness
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"])  # readiness: quick DB check
    def readyz(db: Session = Depends(get_db)) -> dict[str, str]:
        try:
            db.execute("SELECT 1")
            return {"status": "ready"}
        except Exception:  # pragma: no cover - defensive
            raise HTTPException(status_code=503, detail="database not ready")

    @app.get("/api/messages", response_model=list[MessageOut])
    def list_messages(db: Session = Depends(get_db)) -> list[MessageOut]:
        messages = (
            db.query(Message)
            .order_by(Message.created_at.desc())
            .limit(settings.default_list_limit)
            .all()
        )
        return list(reversed(messages))

    def current_user(request: Request, db: Session) -> User | None:
        uid = request.session.get("user_id")
        if uid is None:
            return None
        user = db.get(User, uid)
        return user

    class UserOut(BaseModel):
        id: int
        handle: str

    @app.post("/api/auth/login", response_model=UserOut)
    def login(payload: dict, request: Request, db: Session = Depends(get_db)) -> UserOut:
        handle = str(payload.get("handle", "")).strip()
        if not handle:
            raise HTTPException(status_code=422, detail="handle required")
        user = db.query(User).filter(User.handle == handle).first()
        if user is None:
            user = User(handle=handle)
            db.add(user)
            db.commit()
            db.refresh(user)
        request.session["user_id"] = user.id
        return UserOut(id=user.id, handle=user.handle)

    @app.get("/api/me", response_model=UserOut)
    def me(request: Request, db: Session = Depends(get_db)) -> UserOut:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        return UserOut(id=user.id, handle=user.handle)

    @app.get("/api/users", response_model=list[UserOut])
    def search_users(q: str = "", db: Session = Depends(get_db)) -> list[UserOut]:
        items = db.query(User).filter(User.handle.like(f"%{q}%")).order_by(User.handle.asc()).limit(20).all()
        return [UserOut(id=u.id, handle=u.handle) for u in items]

    @app.get("/api/boxes/{box}", response_model=list[MessageOut])
    def list_box(
        box: str,
        request: Request,
        db: Session = Depends(get_db),
        q: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> list[MessageOut]:
        if box not in {"inbox", "sent", "drafts"}:
            raise HTTPException(status_code=400, detail="invalid box")
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        query = db.query(Message)
        if box == "inbox":
            query = query.filter(Message.recipient_id == user.id)
        elif box == "sent":
            query = query.filter(Message.sender_id == user.id)
        else:
            query = query.filter(Message.box == "drafts")
        if q:
            like = f"%{q}%"
            query = query.filter((Message.body.like(like)) | (Message.author.like(like)) | (Message.recipient.like(like)))
        page = max(1, page)
        limit = max(1, min(limit, 100))
        offset = (page - 1) * limit
        messages = query.order_by(Message.created_at.desc()).offset(offset).limit(limit).all()
        return messages

    class ComposeIn(BaseModel):
        recipient: str = Field(..., max_length=64, min_length=1)
        body: str = Field(..., max_length=280, min_length=1)

    @app.post("/api/compose", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
    def compose(payload: ComposeIn, request: Request, db: Session = Depends(get_db)) -> MessageOut:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        to_handle = payload.recipient.strip()
        if not to_handle or not payload.body.strip():
            raise HTTPException(status_code=422, detail="내용을 입력해주세요.")
        recipient_user = db.query(User).filter(User.handle == to_handle).first()
        if recipient_user is None:
            # auto-create recipient in app-only model
            recipient_user = User(handle=to_handle)
            db.add(recipient_user)
            db.commit()
            db.refresh(recipient_user)
        message = Message(
            author=user.handle,
            recipient=recipient_user.handle,
            body=payload.body.strip(),
            box="sent",
            read=True,
            sender_id=user.id,
            recipient_id=recipient_user.id,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return MessageOut.model_validate(message)

    # Drafts
    class DraftIn(BaseModel):
        recipient: str = Field("", max_length=64)
        body: str = Field("", max_length=280)

    class DraftOut(BaseModel):
        id: int
        recipient: str | None = None
        body: str | None = None
        created_at: datetime

    @app.post("/api/drafts", response_model=DraftOut)
    def save_draft(payload: DraftIn, request: Request, db: Session = Depends(get_db)) -> DraftOut:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        # find existing draft by sender_id with empty recipient/body pair to keep one active draft
        draft = (
            db.query(Message)
            .filter(Message.box == "drafts", Message.sender_id == user.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        if draft is None:
            draft = Message(
                author=user.handle,
                recipient=payload.recipient.strip() or None,
                body=(payload.body or "").strip(),
                box="drafts",
                read=True,
                sender_id=user.id,
            )
            db.add(draft)
        else:
            draft.recipient = payload.recipient.strip() or draft.recipient
            draft.body = (payload.body or draft.body or "").strip()
        db.commit(); db.refresh(draft)
        return DraftOut(id=draft.id, recipient=draft.recipient, body=draft.body, created_at=draft.created_at)

    @app.post("/api/drafts/{draft_id}/send", response_model=MessageOut)
    def send_draft(draft_id: int, request: Request, db: Session = Depends(get_db)) -> MessageOut:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        draft = db.get(Message, draft_id)
        if draft is None or draft.box != "drafts" or draft.sender_id != user.id:
            raise HTTPException(status_code=404, detail="not found")
        to = (draft.recipient or "").strip()
        if not to or not (draft.body or "").strip():
            raise HTTPException(status_code=422, detail="recipient/body required")
        recipient_user = db.query(User).filter(User.handle == to).first()
        if recipient_user is None:
            recipient_user = User(handle=to)
            db.add(recipient_user); db.commit(); db.refresh(recipient_user)
        draft.box = "sent"
        draft.recipient_id = recipient_user.id
        draft.read = True
        db.commit(); db.refresh(draft)
        return MessageOut.model_validate(draft)

    @app.get("/api/counters")
    def counters(request: Request, db: Session = Depends(get_db)) -> dict[str, int]:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        inbox_count = db.query(Message).filter(Message.recipient_id == user.id).count()
        inbox_unread = db.query(Message).filter(Message.recipient_id == user.id, Message.read == False).count()  # noqa: E712
        sent_count = db.query(Message).filter(Message.sender_id == user.id).count()
        drafts_count = db.query(Message).filter(Message.sender_id == user.id, Message.box == "drafts").count()
        return {"inbox": inbox_count, "inbox_unread": inbox_unread, "sent": sent_count, "drafts": drafts_count}

    @app.get("/api/messages/{message_id}", response_model=MessageOut)
    def get_message(message_id: int, request: Request, db: Session = Depends(get_db)) -> MessageOut:
        user = current_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        message = db.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=404, detail="not found")
        # Access control: allow sender or recipient; allow legacy records without ids
        if (message.sender_id not in (None, user.id)) and (message.recipient_id not in (None, user.id)):
            raise HTTPException(status_code=403, detail="forbidden")
        return MessageOut.model_validate(message)

    class IncomingIn(BaseModel):
        author: str = Field(..., max_length=64, min_length=1)
        body: str = Field(..., max_length=280, min_length=1)

    @app.post("/api/incoming", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
    def incoming(payload: IncomingIn, db: Session = Depends(get_db)) -> MessageOut:
        message = Message(
            author=payload.author.strip(),
            recipient=settings.device_name,
            body=payload.body.strip(),
            box="inbox",
            read=False,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return MessageOut.model_validate(message)

    # Backward-compatible endpoint used by earlier UI/tests
    class LegacyCreate(BaseModel):
        author: str = Field(..., max_length=64, min_length=1)
        body: str = Field(..., max_length=280, min_length=1)

    @app.post("/api/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
    def legacy_create(payload: LegacyCreate, db: Session = Depends(get_db)) -> MessageOut:
        message = Message(author=payload.author.strip(), body=payload.body.strip(), box="inbox", read=False)
        db.add(message)
        db.commit()
        db.refresh(message)
        return MessageOut.model_validate(message)

    @app.get("/api/messages/{message_id}", response_model=MessageOut)
    def get_message(message_id: int, db: Session = Depends(get_db)) -> MessageOut:
        message = db.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=404, detail="not found")
        return MessageOut.model_validate(message)

    class UpdateMessageIn(BaseModel):
        read: bool | None = None

    @app.patch("/api/messages/{message_id}", response_model=MessageOut)
    def update_message(message_id: int, payload: UpdateMessageIn, db: Session = Depends(get_db)) -> MessageOut:
        message = db.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=404, detail="not found")
        if payload.read is not None:
            message.read = payload.read
        db.add(message)
        db.commit()
        db.refresh(message)
        return MessageOut.model_validate(message)

    @app.delete("/api/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_message(message_id: int, db: Session = Depends(get_db)) -> None:
        message = db.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="존재하지 않는 메시지입니다.")
        db.delete(message)
        db.commit()

    # Simple static caching headers for assets
    @app.middleware("http")
    async def add_static_cache_headers(request: Request, call_next):  # type: ignore[no-redef]
        response: Response = await call_next(request)
        if request.url.path.startswith("/static/") and response.status_code == 200:
            response.headers.setdefault("Cache-Control", "public, max-age=3600")
        return response

    # Generic error handler to avoid leaking internals
    @app.exception_handler(Exception)
    async def server_error_handler(_: Request, exc: Exception):  # pragma: no cover - fallback safety
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

    return app


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):  # pragma: no cover
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA foreign_keys=ON;")
        finally:
            cursor.close()


Base.metadata.create_all(bind=engine)
_ensure_schema()

app = create_app()
