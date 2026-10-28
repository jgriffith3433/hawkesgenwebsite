// Friends (src/friends.ts): friendships both ways, made when a game invite is accepted (the games area calls addFriend)
// or when two players have both asked (presence.ts). The SQLite table had an id and a unique (user_id, friend_id); here
// the pair is the document id, `friends/{user_id}:{friend_id}`, so "unique" is the key itself (cloud/migrate.mjs agrees).
import { db, users } from './store.ts';
import { id, route, send } from './http.ts';
import { requireUser } from './accounts.ts';
import { USER_ID } from './config.ts';

export const friends = () => db.collection('friends');
export const friendKey = (userId: string, friendId: string) => `${userId}:${friendId}`;

/** Makes two players friends (both rows, in one batch). Already friends: nothing changes. */
export async function addFriend(userId: string, friendId: string, t?: FirebaseFirestore.Transaction) {
  if (userId === friendId) return;
  const now = Date.now();
  const rows: [string, string][] = [[userId, friendId], [friendId, userId]];
  if (t) {
    for (const [a, b] of rows) t.set(friends().doc(friendKey(a, b)), { id: id('fr_'), user_id: a, friend_id: b, created: now }, { merge: true });
    return;
  }
  const batch = db.batch();
  for (const [a, b] of rows) batch.set(friends().doc(friendKey(a, b)), { id: id('fr_'), user_id: a, friend_id: b, created: now }, { merge: true });
  await batch.commit();
}

export async function listFriends(userId: string) {
  const s = await friends().where('user_id', '==', userId).get();
  if (s.empty) return [];
  const people = await db.getAll(...s.docs.map((d) => users().doc(String(d.get('friend_id')))));
  const name = new Map(people.filter((p) => p.exists).map((p) => [p.id, (p.get('name') ?? null) as string | null]));
  return s.docs
    .filter((d) => name.has(String(d.get('friend_id'))))
    .map((d) => ({ id: String(d.get('friend_id')), name: name.get(String(d.get('friend_id'))) ?? null, created: Number(d.get('created')) }))
    .sort((a, b) => String(a.name ?? '').toLowerCase().localeCompare(String(b.name ?? '').toLowerCase()));
}

export async function removeFriend(userId: string, friendId: string) {
  const batch = db.batch();
  batch.delete(friends().doc(friendKey(userId, friendId)));
  batch.delete(friends().doc(friendKey(friendId, userId)));
  await batch.commit();
}

export const areFriends = async (a: string, b: string, t?: FirebaseFirestore.Transaction) =>
  (t ? await t.get(friends().doc(friendKey(a, b))) : await friends().doc(friendKey(a, b)).get()).exists;

route('GET', '/v1/friends', async ({ req }) => ({ friends: await listFriends((await requireUser(req)).id) }));
route('DELETE', new RegExp(`^/v1/friends/(${USER_ID})$`), async ({ req, res, params }) => {
  await removeFriend((await requireUser(req)).id, params[0]);
  send(res, 200, { ok: true });
});
