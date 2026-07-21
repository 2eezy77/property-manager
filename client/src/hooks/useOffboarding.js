import { useCallback, useEffect, useState } from 'react';
import api from '@/api/axios';

let listeners = [];

export function notifyOffboardingRefresh() {
  listeners.forEach((fn) => fn());
}

export function useOffboarding({ enabled = true } = {}) {
  const [offboarding, setOffboarding] = useState(null);
  const [loading, setLoading] = useState(!!enabled);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await api.get('/api/users/me/offboarding');
      setOffboarding(data);
    } catch {
      setOffboarding(null);
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
    const onRefresh = () => refetch();
    listeners.push(onRefresh);
    return () => {
      listeners = listeners.filter((fn) => fn !== onRefresh);
    };
  }, [enabled, refetch]);

  return { offboarding, loading, refetch };
}
