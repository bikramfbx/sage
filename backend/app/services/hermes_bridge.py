import httpx
from typing import Dict, Any
from app.core.config import settings


class HermesBridge:
    def __init__(self):
        self.base_url = settings.hermes_agent_url
        self.timeout = 120.0

    async def chat(self, message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        # Bridge to Hermes Agent running in NVIDIA OpenShell
        # Routes through NemoClaw for secure network traffic
        payload = {
            "message": message,
            "context": context or {},
            "model": "nemotron-4-340b",  # via Nebius
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/chat", json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            # Fallback response for development
            return {
                "response": f"[SAGE Bridge] Hermes Agent unreachable at {self.base_url}. "
                            f"Ensure Hermes is running in OpenShell with NemoClaw configured. Error: {str(e)}",
                "metadata": {"bridge": "hermes", "status": "fallback"},
            }


hermes_bridge = HermesBridge()
