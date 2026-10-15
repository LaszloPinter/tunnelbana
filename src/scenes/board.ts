import * as account from '../net/account.ts';
import { dailySeed, type Menu } from '../ui/dom/menu.ts';

/**
 * THE DAILY BOARD ON THE LANDING: today's top three under the daily row,
 * the reason to try it, and the Leaderboard dialog, top twenty with your
 * own row lit. Silent when there is no board to read (offline, no Firebase).
 */
export async function refreshBoard(menu: Menu | null) {
  const rows = await account.dailyBoard(dailySeed().date, 3);
  // unreadable: say nothing, rather than "nobody has played"
  if (!rows) return;
  menu?.setState({ dailyTop: rows.map((r) => ({ name: r.name, score: r.score, stops: r.stops })) });
}

export async function showBoard(menu: Menu | null) {
  const d = dailySeed();
  menu?.showBoard(d.date, null);
  const rows = await account.dailyBoard(d.date, 20);
  const me = account.account()?.uid;
  menu?.showBoard(
    d.date,
    rows
      ? rows.map((r) => ({
          name: r.name,
          score: r.score,
          stops: r.stops,
          rides: r.rides,
          mine: r.uid === me,
        }))
      : 'offline',
  );
}
