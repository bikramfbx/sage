import logging

from fastapi import APIRouter

from app.schemas.chat import AgentState
from app.services.sage_brain import sage_brain
from skills import daily_summary as ds

logger = logging.getLogger("sage")

router = APIRouter()


@router.get("/summary/daily")
async def daily_summary():
    data = ds.gather(sage_brain.tracker, sage_brain.schedule)
    briefing = None
    generated_by = "offline"
    if sage_brain.client is not None:
        try:
            response = await sage_brain.client.chat.completions.create(
                model=sage_brain.model,
                messages=[
                    {"role": "system", "content": ds.SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": ds.compose_prompt(data)},
                ],
                temperature=0.4,
                max_tokens=1000,
            )
            briefing = ds.parse_briefing(response.choices[0].message.content)
            generated_by = "llm"
        except Exception as exc:
            logger.warning("Daily summary LLM call failed: %s", str(exc)[:200])
    if briefing is None:
        briefing = ds.offline_briefing(data)
        generated_by = "offline"

    return {
        "summary": briefing,
        "generated_by": generated_by,
        "data": data,
    }
