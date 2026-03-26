FROM python:3.10-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV MEDIA_ROOT=/data

COPY . /app

EXPOSE 8080

CMD ["python3", "-m", "src.server", "--host", "0.0.0.0", "--port", "8080"]
