# Y2K 문자메세지 SNS

레트로 폴더폰 UI를 그대로 재현한 한국어 문자메세지 SNS 서비스입니다. FastAPI와 SQLite를 사용하여 메시지를 저장하며, 웹 브라우저만으로 빠르게 사용할 수 있습니다.

## 빠른 시작

```bash
pip install -e .
uvicorn main:app --host 0.0.0.0 --port 8000
```

서버가 실행되면 <http://localhost:8000> 에 접속하여 서비스를 이용할 수 있습니다.

## 주요 기능

- 2000년대 폴더폰 문자 UI를 현대 브라우저에서 픽셀 단위로 복원한 디자인
- SQLite 기반의 영구 저장소에 메시지를 기록 및 조회
- 작성자/메시지 입력폼과 실시간 메시지 피드
- 메시지 삭제 기능 및 오류 처리

## 배포 안내

프로덕션 환경에서는 `gunicorn` + `uvicorn.workers.UvicornWorker` 조합으로 FastAPI 앱을 실행하고, 리버스 프록시(Nginx 등)를 앞단에 두는 구성을 권장합니다. 데이터베이스 파일(`y2k_messages.db`)이 지속적으로 저장될 수 있도록 쓰기 권한이 있는 위치에 배치하세요.

### 환경 변수

- `APP_TITLE`: 앱 제목 (기본: `Y2K 문자메세지`)
- `DATABASE_URL`: DB 연결 문자열 (기본: `sqlite:///./y2k_messages.db`)
- `CORS_ORIGINS`: 허용할 오리진, 콤마 구분 (기본: `*`)
- `TRUSTED_HOSTS`: 신뢰 호스트, 콤마 구분 (기본: `*`)
- `ENFORCE_HTTPS`: HTTPS 강제 여부 (`true`/`false`, 기본: `false`)
- `HOST`: 바인딩 호스트 (기본: `0.0.0.0`)
- `PORT`: 포트 (기본: `8000`)
- `LOG_LEVEL`: `debug|info|warning|error` (기본: `info`)

헬스체크 엔드포인트: `/healthz`(liveness), `/readyz`(readiness)

### Docker로 실행

```bash
docker build -t y2k:latest .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL=sqlite:////data/y2k_messages.db \
  -v $(pwd)/data:/data \
  y2k:latest
```

쿠버네티스/컨테이너 환경에서는 `y2k_messages.db`를 외부 볼륨에 마운트하여 영속화하세요.

### CI

리포지토리에 GitHub Actions 워크플로(`.github/workflows/ci.yml`)가 포함되어 있으며, `ruff` 검사와 `pytest` 테스트를 수행합니다.
