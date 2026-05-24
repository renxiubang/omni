"""User-related API routes for Omni Chat application."""

import re
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import create_user, get_user_by_username

router = APIRouter(prefix="/api/users", tags=["users"])

# Username validation pattern: only letters, numbers, underscores, 1-50 characters
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]{1,50}$")


class UserLoginRequest(BaseModel):
    """Request model for user login."""
    username: str


class UserResponse(BaseModel):
    """Response model for user data."""
    id: int
    username: str
    created_at: str


@router.post("/login", response_model=UserResponse)
async def login(request: UserLoginRequest) -> dict:
    """
    Simulate user login.
    
    Creates a new user if username doesn't exist,
    or returns existing user if username already exists.
    No password required for this simulation.
    """
    username = request.username.strip()
    
    # Validate username
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username can only contain letters, numbers, and underscores (1-50 characters)"
        )
    
    # Create or get existing user
    try:
        user = create_user(username)
        return user
    except Exception as e:
        print(f"Error in login: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    username: str = Query(..., description="Username to look up")
) -> dict:
    """
    Get user information by username.
    
    This simulates getting current user info.
    In a real app, this would use a session token or JWT.
    """
    if not username:
        raise HTTPException(status_code=400, detail="Username parameter is required")
    
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    
    return user
