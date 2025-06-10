# Dockerfile in c:\GoogleHack\traffic_api\

# Use an official Python runtime as a parent image
# Choose a version compatible with your code, e.g., 3.9, 3.10, 3.11
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
# This is done first to leverage Docker's layer caching if requirements haven't changed
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# --no-cache-dir reduces image size
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application code (main.py, your .joblib model, etc.)
# from your traffic_api directory into the container at /app
COPY . .

# Make port 8000 available to the world outside this container
# This is the port Uvicorn will listen on inside the container.
# Render (or other platforms) will map their public port to this internal port.
EXPOSE 8000

# Command to run the application using Uvicorn
# --host 0.0.0.0 makes the server accessible from outside the container.
# --port 8000 tells Uvicorn which port to use inside the container.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]