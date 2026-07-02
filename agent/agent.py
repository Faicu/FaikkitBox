"""Faikkitbox Agent – rulează pe mini-PC și expune comenzi permise via HTTP."""
import os
import subprocess
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

TOKEN = os.environ.get("AGENT_TOKEN", "")

# Each command maps to either a single argv list OR a list of steps.
# A step is either an argv list or {"sleep": seconds} to wait between commands.
COMMANDS = {
    "apt_update":     ["sudo", "apt-get", "update"],
    "apt_upgrade":    ["sudo", "apt-get", "-y", "upgrade"],
    "flush_dns": [
        ["sudo", "resolvectl", "flush-caches"],
        {"sleep": 2},
        ["sudo", "systemctl", "restart", "qbittorrent-nox"],
    ],
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
    spec = COMMANDS[req.cmd]
    # Normalize to a list of steps.
    if spec and isinstance(spec[0], str):
        steps = [spec]
    else:
        steps = spec
    import time
    stdout_parts = []
    stderr_parts = []
    last_code = 0
    try:
        for step in steps:
            if isinstance(step, dict) and "sleep" in step:
                time.sleep(float(step["sleep"]))
                stdout_parts.append(f"[sleep {step['sleep']}s]\n")
                continue
            argv = step
            stdout_parts.append(f"$ {' '.join(argv)}\n")
            p = subprocess.run(argv, capture_output=True, text=True, timeout=1800)
            last_code = p.returncode
            if p.stdout:
                stdout_parts.append(p.stdout)
            if p.stderr:
                stderr_parts.append(p.stderr)
            if p.returncode != 0:
                # Continue with remaining steps? No — abort on failure.
                break
        return {
            "exit_code": last_code,
            "stdout": "".join(stdout_parts),
            "stderr": "".join(stderr_parts),
        }
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, f"Timeout after {e.timeout}s")
    except Exception as e:
        raise HTTPException(500, str(e))