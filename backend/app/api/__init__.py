from fastapi import APIRouter
from .auth import router as auth_router
from .transactions import router as transactions_router
from .portfolio import router as portfolio_router
from .chat_history import router as chat_router
from .stocks import router as stocks_router
from .websocket_endpoint import router as ws_router
from .user_profile import router as profile_router
from ..routers.market import router as market_router
from .goals import router as goals_router
from .alerts import router as alerts_router
from .support import router as support_router
from .social import router as social_router
from .paper_trading import router as paper_trading_router
from .community import router as community_router
from .dividends import router as dividends_router
from .admin import router as admin_router
from .analysis_extra import router as analysis_extra_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["Auth"])
api_router.include_router(transactions_router, prefix="/transactions", tags=["Transactions"])
api_router.include_router(portfolio_router, prefix="/portfolio", tags=["Portfolio"])
api_router.include_router(chat_router, prefix="/chat", tags=["Chat History"])
api_router.include_router(stocks_router, prefix="/stocks", tags=["Stocks"])
api_router.include_router(ws_router, prefix="", tags=["WebSocket"])
api_router.include_router(profile_router, prefix="/user-profile", tags=["User Profile"])
api_router.include_router(market_router, prefix="/market", tags=["Market"])
api_router.include_router(goals_router, prefix="/goals", tags=["Goals"])
api_router.include_router(alerts_router, prefix="/alerts", tags=["Alerts"])
api_router.include_router(support_router, prefix="/support", tags=["Support"])
api_router.include_router(social_router, prefix="/social", tags=["Social"])
api_router.include_router(paper_trading_router, prefix="/paper-trading", tags=["Paper Trading"])
api_router.include_router(community_router, prefix="/community", tags=["Community"])
api_router.include_router(dividends_router, prefix="/dividends", tags=["Dividends"])
api_router.include_router(admin_router, prefix="/admin", tags=["Admin"])
api_router.include_router(analysis_extra_router, prefix="/stocks", tags=["Analysis"])