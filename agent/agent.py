"""Faikkitbox Agent – rulează pe mini-PC și expune comenzi permise via HTTP."""
import os
import subprocess
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

TOKEN = os.environ.get("AGENT_TOKEN", "")

COMMANDS = {
    "apt_update":     ["sudo", "apt-get", "update"],
    "apt_upgrade":    ["sudo", "apt-get", "-y", "upgrade"],
    "flush_dns":      ["sudo", "resolvectl", "flush-caches"],
    "restart_plex":   ["sudo", "systemctl", "restart", "plexmediaserver"],
    "restart_qbit":   ["sudo", "systemctl", "restart", "qbittorrent-nox"],
    "restart_immich": ["sudo", "docker", "compose", "-f", "/opt/immich/docker-compose.yml", "restart"],
    "uptime":         ["uptime"],
}

app = FastAPI()


class ExecReq(BaseModel):
    cmd: str


def check_auth(authorization):
    if not TOKEN:
        raise HTTPException(500, "AGENT_TOKEN not configured on agent")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    if authorization[len("Bearer "):].strip() != TOKEN:
        raise HTTPException(401, "Invalid token")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/exec")
def exec_cmd(req: ExecReq, authorization: str = Header(default=None)):
    check_auth(authorization)
    if req.cmd not in COMMANDS:
        raise HTTPException(400, f"Command not allowed: {req.cmd}")
    argv = COMMANDS[req.cmd]
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=600)
        return {
            "exit_code": p.returncode,
            "stdout": p.stdout[-4000:],
            "stderr": p.stderr[-4000:],
        }
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, f"Timeout after {e.timeout}s")
    except Exception as e:
        raise HTTPException(500, str(e))