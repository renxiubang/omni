"""Database module for Omni Chat application.

This module provides SQLite database initialization and CRUD operations
for users and wordbook tables.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any


DATABASE_PATH = Path(__file__).parent.parent.parent / "omni.db"


def get_db_connection() -> sqlite3.Connection:
    """Create and return a database connection."""
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize the database by creating tables if they don't exist."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # Create wordbook table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS wordbook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            phonetic_uk TEXT,
            phonetic_us TEXT,
            explanation TEXT NOT NULL,
            example_sentence_en TEXT,
            example_sentence_zh TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, word),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    # Create index for faster queries
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_wordbook_user_id 
        ON wordbook (user_id)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_wordbook_word 
        ON wordbook (word)
    """)

    conn.commit()
    conn.close()
    print(f"Database initialized at {DATABASE_PATH}")


def create_user(username: str) -> Dict[str, Any]:
    """Create a new user or return existing user if username already exists."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Try to create new user
        created_at = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            "INSERT INTO users (username, created_at) VALUES (?, ?)",
            (username, created_at)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return {
            "id": user_id,
            "username": username,
            "created_at": created_at
        }
    except sqlite3.IntegrityError:
        # User already exists, get existing user
        conn.rollback()
        cursor.execute(
            "SELECT id, username, created_at FROM users WHERE username = ?",
            (username,)
        )
        row = cursor.fetchone()
        return dict(row)
    finally:
        conn.close()


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Get user by username."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id, username, created_at FROM users WHERE username = ?",
        (username,)
    )
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Get user by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id, username, created_at FROM users WHERE id = ?",
        (user_id,)
    )
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


def add_word_to_wordbook(
    user_id: int,
    word: str,
    phonetic_uk: str = "",
    phonetic_us: str = "",
    explanation: str = "",
    example_sentence_en: str = "",
    example_sentence_zh: str = ""
) -> Dict[str, Any]:
    """Add a word to user's wordbook."""
    conn = get_db_connection()
    cursor = conn.cursor()

    created_at = datetime.now(timezone.utc).isoformat()

    try:
        cursor.execute("""
            INSERT INTO wordbook 
            (user_id, word, phonetic_uk, phonetic_us, explanation, 
             example_sentence_en, example_sentence_zh, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (user_id, word, phonetic_uk, phonetic_us, explanation,
              example_sentence_en, example_sentence_zh, created_at))

        conn.commit()
        word_id = cursor.lastrowid

        return {
            "id": word_id,
            "user_id": user_id,
            "word": word,
            "phonetic_uk": phonetic_uk,
            "phonetic_us": phonetic_us,
            "explanation": explanation,
            "example_sentence_en": example_sentence_en,
            "example_sentence_zh": example_sentence_zh,
            "created_at": created_at
        }
    except sqlite3.IntegrityError:
        # Word already exists in wordbook
        conn.rollback()
        raise ValueError(f"Word '{word}' already exists in wordbook")
    finally:
        conn.close()


def get_user_wordbook(user_id: int) -> List[Dict[str, Any]]:
    """Get all words in user's wordbook, ordered by created_at descending."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, user_id, word, phonetic_uk, phonetic_us, explanation,
               example_sentence_en, example_sentence_zh, created_at
        FROM wordbook
        WHERE user_id = ?
        ORDER BY created_at DESC
    """, (user_id,))

    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def delete_word_from_wordbook(word_id: int, user_id: int) -> bool:
    """Delete a word from user's wordbook."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "DELETE FROM wordbook WHERE id = ? AND user_id = ?",
        (word_id, user_id)
    )

    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()

    return deleted


def check_word_in_wordbook(user_id: int, word: str) -> Optional[Dict[str, Any]]:
    """Check if a word is already in user's wordbook."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, user_id, word, phonetic_uk, phonetic_us, explanation,
               example_sentence_en, example_sentence_zh, created_at
        FROM wordbook
        WHERE user_id = ? AND word = ?
    """, (user_id, word))

    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None
