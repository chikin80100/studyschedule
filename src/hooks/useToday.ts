import { useEffect, useState } from 'react';
import { today as todayString } from '../lib/date';

/**
 * 今日の日付。アプリを開いたまま日付が変わっても追従するよう、
 * 日付が変わる時刻と、タブが再表示されたタイミングで見直す。
 */
export function useToday(): string {
  const [today, setToday] = useState(todayString);

  useEffect(() => {
    const sync = () => setToday(todayString());

    const scheduleNextMidnight = (): number => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 1, 0);
      return window.setTimeout(() => {
        sync();
        timer = scheduleNextMidnight();
      }, midnight.getTime() - now.getTime());
    };

    let timer = scheduleNextMidnight();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return today;
}
