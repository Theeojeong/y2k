from __future__ import annotations

from y2kapp import app
from y2kapp.settings import settings


def main() -> None:
    import uvicorn

    uvicorn.run(
        "y2kapp:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
