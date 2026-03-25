FROM python:3.11-slim

WORKDIR /app

# Install dependencies with pip cache disabled
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the FastAPI application logic
COPY main.py .

# Run Uvicorn, but tell it to listen on the Docker Desktop guest socket
# The socket name "backend.sock" must match the service name in docker-compose.yaml
CMD ["uvicorn", "main:app", "--uds", "/run/guest-services/backend.sock"]