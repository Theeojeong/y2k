from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from starlette.templating import Jinja2Templates

APP_TITLE = "Y2K 문자메세지"
DATABASE_URL = "sqlite:///./y2k_messages.db"


class Base(DeclarativeBase):
    pass


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    author: Mapped[str] = mapped_column(String(32))
    body: Mapped[str] = mapped_column(String(280))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


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

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    author: str = Field(..., max_length=32, min_length=1)
    body: str = Field(..., max_length=280, min_length=1)


Base.metadata.create_all(bind=engine)


def create_app() -> FastAPI:
    app = FastAPI(title=APP_TITLE)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    base_dir = Path(__file__).resolve().parent
    static_path = base_dir / "static"
    templates_path = base_dir / "templates"

    app.mount("/static", StaticFiles(directory=static_path), name="static")
    templates = Jinja2Templates(directory=str(templates_path))

    @app.get("/", response_class=HTMLResponse)
    def read_index(request: Request) -> HTMLResponse:
        return templates.TemplateResponse("index.html", {"request": request, "title": APP_TITLE})

    @app.get("/api/messages", response_model=list[MessageOut])
    def list_messages(db: Session = Depends(get_db)) -> list[MessageOut]:
        messages = (
            db.query(Message)
            .order_by(Message.created_at.desc())
            .limit(50)
            .all()
        )
        return list(reversed(messages))

    @app.post("/api/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
    def create_message(payload: MessageCreate, db: Session = Depends(get_db)) -> MessageOut:
        message = Message(author=payload.author.strip(), body=payload.body.strip())
        if not message.author or not message.body:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="내용을 입력해주세요.")
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

    return app


app = create_app()
