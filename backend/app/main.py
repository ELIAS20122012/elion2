from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, engine
from .routers import accounts, auth, events

app = FastAPI(title="Robot Trading API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to the dashboard's real origin before going to production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(events.router)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}
