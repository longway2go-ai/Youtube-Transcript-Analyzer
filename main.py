from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.requests import Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from openai import OpenAI
import os, re, uvicorn, httpx

# -----------------------------------------------------------------
# init
# -----------------------------------------------------------------
load_dotenv()
app = FastAPI(title="YT-Transcript-AI (fetch/list only)")

app.mount("/static", StaticFiles(directory="static"), name="static")

# -----------------------------------------------------------------
# Global Exception Handlers (NEW - fixes JSON error)
# -----------------------------------------------------------------
@app.exception_handler(Exception)
async def all_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions and return JSON instead of HTML"""
    if isinstance(exc, HTTPException):
        return await http_exception_handler(request, exc)
    
    # Return JSON for all other exceptions
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": f"Internal Server Error: {str(exc)}"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors and return JSON"""
    return JSONResponse(
        status_code=422,
        content={"success": False, "error": f"Validation Error: {exc.errors()}"}
    )

@app.exception_handler(HTTPException)
async def http_exception_handler_custom(request: Request, exc: HTTPException):
    """Handle HTTP exceptions and return JSON"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail}
    )

# -----------------------------------------------------------------
# Pydantic DTOs
# -----------------------------------------------------------------
class URLRequest(BaseModel):
    url: str

class QuestionRequest(BaseModel):
    question: str
    transcript: str

class TranscriptResponse(BaseModel):
    success: bool
    transcript: str | None = None
    video_id: str | None = None
    error: str | None = None

class AnswerResponse(BaseModel):
    success: bool
    answer: str | None = None
    error: str | None = None

# -----------------------------------------------------------------
# helpers
# -----------------------------------------------------------------
def extract_video_id(url: str) -> str | None:
    if "watch?v=" in url:
        return url.split("watch?v=")[-1].split("&")[0]
    if "youtu.be/" in url:
        return url.split("youtu.be/")[-1].split("?")[0]
    m = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11})", url)
    return m.group(1) if m else None

async def fetch_transcript_with_fetch_and_list(video_id: str) -> str:
    """
    Only uses  .fetch()   and   .list()  — never get_transcript().
    """
    try:
        api = YouTubeTranscriptApi()

        # --- 1️⃣  try the simple fetch -----------------------------
        try:
            raw = api.fetch(video_id)
        except Exception as fetch_error:
            raw = None
            fetch_exc = fetch_error
        else:
            fetch_exc = None

        # --- 2️⃣  if fetch failed, inspect list() -------------------
        if raw is None:
            try:
                listed = api.list(video_id)
            except Exception as list_error:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not fetch transcript. "
                           f"fetch() error: {fetch_exc}. list() error: {list_error}"
                )

            # two possible shapes:
            # a) list() already returns the transcript (oldest builds)
            if isinstance(listed, list) and listed and isinstance(listed[0], dict):
                raw = listed

            # b) list() returns a transcript-descriptor that still needs .fetch()
            else:
                try:
                    # pick the first descriptor that has English or just the first one
                    chosen = None
                    for desc in listed:
                        lang = getattr(desc, "language_code", "") or getattr(desc, "language", "")
                        if str(lang).lower().startswith(("en", "a.en")):
                            chosen = desc
                            break
                    chosen = chosen or listed[0]
                    raw = chosen.fetch()
                except Exception as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"list() succeeded but .fetch() on descriptor failed: {e}"
                    )

        # --- 3️⃣  normalise to plain text --------------------------
        if isinstance(raw, list):
            text = " ".join(
                entry.get("text", str(entry)) if isinstance(entry, dict) else str(entry)
                for entry in raw
            )
        elif isinstance(raw, dict):
            inner = raw.get("transcript") or raw.get("body") or raw
            text = " ".join(
                entry.get("text", str(entry)) if isinstance(entry, dict) else str(entry)
                for entry in (inner if isinstance(inner, list) else [inner])
            )
        else:
            text = str(raw)

        text = text.strip()
        if len(text) < 10:
            raise HTTPException(status_code=400, detail="Transcript is empty or too short.")
        return text
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error in transcript fetching: {str(e)}")

def openai_client() -> OpenAI:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured.")
    
    return OpenAI(api_key=key)

async def answer_with_openai(transcript: str, question: str) -> str:
    client = openai_client()

    # Keep transcript reasonable length
    if len(transcript) > 4000:
        transcript = transcript[:4000] + "..."

    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "user", 
                "content": f"Based on this YouTube transcript, answer the question.\n\nTranscript: {transcript}\n\nQuestion: {question}\n\nAnswer:"
            }
        ],
        max_tokens=300,
        temperature=0.7
    )
    
    return response.choices[0].message.content

# -----------------------------------------------------------------
# routes
# -----------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def root():
    return FileResponse("static/index.html")

@app.post("/api/transcript", response_model=TranscriptResponse)
async def api_transcript(req: URLRequest):
    try:
        vid = extract_video_id(req.url)
        if not vid:
            return TranscriptResponse(success=False, error="Invalid YouTube URL.")
        
        txt = await fetch_transcript_with_fetch_and_list(vid)
        return TranscriptResponse(success=True, transcript=txt, video_id=vid)
        
    except HTTPException as e:
        return TranscriptResponse(success=False, error=e.detail)
    except Exception as e:
        return TranscriptResponse(success=False, error=f"Unexpected error: {str(e)}")

@app.post("/api/question", response_model=AnswerResponse)
async def api_question(req: QuestionRequest):
    try:
        if not req.question.strip():
            return AnswerResponse(success=False, error="Question cannot be empty.")
        if not req.transcript.strip():
            return AnswerResponse(success=False, error="Transcript is missing.")
        
        ans = await answer_with_openai(req.transcript, req.question)
        return AnswerResponse(success=True, answer=ans)
        
    except HTTPException as e:
        return AnswerResponse(success=False, error=e.detail)
    except Exception as e:
        return AnswerResponse(success=False, error=f"Unexpected error: {str(e)}")

@app.get("/health")
async def health():
    api_key_status = "configured" if os.getenv("OPENAI_API_KEY") else "missing"
    return {
        "status": "healthy",
        "openai_api_key": api_key_status,
        "message": "YouTube Transcript Analyzer is running"
    }

@app.get("/debug")
async def debug():
    return {
        "youtube_api_methods": [method for method in dir(YouTubeTranscriptApi) if not method.startswith('_')],
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
        "environment": "development" if os.getenv("DEBUG") else "production"
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)