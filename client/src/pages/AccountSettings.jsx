import React, { useState, useEffect } from 'react';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';

function normalizeUser(raw) {
  if (!raw) return null;
  return {
    email:      raw.email ?? '',
    firstName:  raw.first_name ?? raw.firstName ?? '',
    lastName:   raw.last_name ?? raw.lastName ?? '',
    phone:      raw.phone ?? '',
  };
}

export default function AccountSettings({ onPasswordChanged }) {
  const { refreshUser } = useAuth();

  const [profile, setProfile] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordErr, setPasswordErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) setProfile(normalizeUser(data.user));
      } catch {
        if (!cancelled) setProfileErr('Could not load profile.');
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function setProfileField(key, value) {
    setProfile((p) => ({ ...p, [key]: value }));
    setProfileMsg('');
    setProfileErr('');
  }

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      const { data } = await api.patch('/api/users/me', {
        firstName: profile.firstName.trim(),
        lastName:  profile.lastName.trim() || undefined,
        phone:     profile.phone.trim() || undefined,
      });
      setProfile(normalizeUser(data.user));
      await refreshUser?.();
      setProfileMsg('Profile updated');
    } catch (err) {
      setProfileErr(err.response?.data?.message ?? 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordMsg('');
    setPasswordErr('');

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordErr('New passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      await api.post('/api/users/me/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword:     passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordMsg('Password updated');
      onPasswordChanged?.();
    } catch (err) {
      if (err.response?.data?.error === 'WRONG_PASSWORD') {
        setPasswordErr('Current password is incorrect');
      } else {
        setPasswordErr(err.response?.data?.message ?? 'Failed to update password.');
      }
    } finally {
      setPasswordSaving(false);
    }
  }

  if (profileLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        Loading account settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Account</h1>
        <p className="mt-1 text-sm text-gray-500">Update your profile and password.</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
        <form onSubmit={handleProfileSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500">Email</label>
            <p className="mt-1 text-sm text-gray-700">{profile.email}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className="block text-xs font-medium text-gray-700">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                value={profile.firstName}
                onChange={(e) => setProfileField('firstName', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-xs font-medium text-gray-700">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={profile.lastName}
                onChange={(e) => setProfileField('lastName', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-gray-700">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfileField('phone', e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          {profileErr && <p className="text-sm text-red-600">{profileErr}</p>}
          {profileMsg && <p className="text-sm text-green-600">{profileMsg}</p>}
          <button
            type="submit"
            disabled={profileSaving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {profileSaving ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
        <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-xs font-medium text-gray-700">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(e) => {
                setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }));
                setPasswordErr('');
                setPasswordMsg('');
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-xs font-medium text-gray-700">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordForm.newPassword}
              onChange={(e) => {
                setPasswordForm((f) => ({ ...f, newPassword: e.target.value }));
                setPasswordErr('');
                setPasswordMsg('');
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-xs font-medium text-gray-700">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordForm.confirmPassword}
              onChange={(e) => {
                setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }));
                setPasswordErr('');
                setPasswordMsg('');
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          {passwordErr && <p className="text-sm text-red-600">{passwordErr}</p>}
          {passwordMsg && <p className="text-sm text-green-600">{passwordMsg}</p>}
          <button
            type="submit"
            disabled={passwordSaving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {passwordSaving ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  );
}
