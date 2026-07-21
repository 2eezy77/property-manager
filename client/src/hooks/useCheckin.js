import { useState, useEffect, useCallback } from 'react';
import api from '@/api/axios';

const listeners = new Set();

export function notifyCheckinRefresh() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCheckin({ enabled = true } = {}) {
  const [checkin, setCheckin] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await api.get('/api/users/me/checkin');
      setCheckin(data);
    } catch {
      setCheckin(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    refetch();
    return subscribe(refetch);
  }, [enabled, refetch]);

  const allComplete = checkin
    && checkin.passwordChanged
    && checkin.bankLinked
    && checkin.leaseViewed
    && checkin.maintenanceViewed;

  return { checkin, loading, refetch, allComplete };
}
