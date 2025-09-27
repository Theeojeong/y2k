from __future__ import annotations

from y2kapp import app


def main() -> None:
    import uvicorn

    uvicorn.run("y2kapp:app", host="0.0.0.0", port=8000, reload=False, log_level="info")


if __name__ == "__main__":
    main()
