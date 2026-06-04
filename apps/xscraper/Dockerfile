# Officiële Playwright Python image: Chromium + alle systeem-deps al voorgeïnstalleerd.
# Pin op een vaste versie zodat browser en playwright-package matchen.
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scraper.py ./

# -u = ongebufferde logs zodat Coolify ze direct toont
CMD ["python", "-u", "scraper.py"]
