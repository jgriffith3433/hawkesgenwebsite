// Friends: bidirectional friendships, created automatically when a game invite is accepted.
import { db, tx } from './db.ts';
import { id } from './util.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  UNIQUE (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friends_user ON friends (user_id);
CREATE INDEX IF NOT EXISTS friends_friend ON friends (friend_id);
`);

export function addFriend(userId: string, friendId: string) {
  if (userId === friendId) return;
  const now = Date.now();
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO friends (id, user_id, friend_id, created) VALUES (?, ?, ?, ?)').run(id('fr_'), userId, friendId, now);
    db.prepare('INSERT OR IGNORE INTO friends (id, user_id, friend_id, created) VALUES (?, ?, ?, ?)').run(id('fr_'), friendId, userId, now);
  });
}

export function listFriends(userId: string) {
  return db.prepare(`
    SELECT f.friend_id AS id, u.name, f.created
    FROM friends f JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ? ORDER BY u.name COLLATE NOCASE
  `).all(userId) as { id: string; name: string | null; created: number }[];
}

export function removeFriend(userId: string, friendId: string) {
  tx(() => {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(userId, friendId);
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(friendId, userId);
  });
}

export function areFriends(a: string, b: string): boolean {
  return !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);
}
