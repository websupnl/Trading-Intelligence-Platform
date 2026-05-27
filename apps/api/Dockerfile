FROM python:3.12-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies from pyproject.toml
# Copy only pyproject.toml first for layer caching
COPY pyproject.toml ./

# Create minimal package stub so pip can resolve the project
RUN mkdir -p app && touch app/__init__.py

# Install all dependencies (not editable, just deps)
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir \
        "fastapi>=0.115.0" \
        "uvicorn[standard]>=0.30.0" \
        "pydantic>=2.9.0" \
        "pydantic-settings>=2.5.0" \
        "sqlalchemy>=2.0.35" \
        "sqlmodel>=0.0.21" \
        "alembic>=1.13.0" \
        "psycopg[binary,pool]>=3.2.0" \
        "redis>=5.1.0" \
        "celery[redis]>=5.4.0" \
        "httpx>=0.27.0" \
        "anthropic>=0.39.0" \
        "openai>=1.51.0" \
        "feedparser>=6.0.11" \
        "praw>=7.8.1" \
        "qdrant-client>=1.11.0" \
        "python-dateutil>=2.9.0" \
        "python-multipart>=0.0.12" \
        "python-dotenv>=1.0.1" \
        "structlog>=24.4.0" \
        "tenacity>=9.0.0" \
        "aiohttp>=3.10.0" \
        "apscheduler>=3.10.4" \
        "pytest>=8.3.0" \
        "pytest-asyncio>=0.24.0"

# Copy full application code
COPY . .

# Create memory directory structure
RUN mkdir -p /app/memory/raw /app/memory/trades /app/memory/lessons \
    /app/memory/pending-rules /app/memory/active-rules /app/memory/rejected-rules \
    /app/memory/sources /app/memory/strategies /app/memory/reflections \
    /app/memory/daily /app/memory/weekly

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
