"""Database package for Omni Chat application.

This package provides database initialization and access functions.
"""

from app.db.database import (
    init_db,
    get_db_connection,
    create_user,
    get_user_by_username,
    get_user_by_id,
    add_word_to_wordbook,
    get_user_wordbook,
    delete_word_from_wordbook,
    check_word_in_wordbook,
)

__all__ = [
    "init_db",
    "get_db_connection",
    "create_user",
    "get_user_by_username",
    "get_user_by_id",
    "add_word_to_wordbook",
    "get_user_wordbook",
    "delete_word_from_wordbook",
    "check_word_in_wordbook",
]
