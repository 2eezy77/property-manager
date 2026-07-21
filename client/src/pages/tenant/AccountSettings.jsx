import AccountSettings from '../AccountSettings';
import { notifyCheckinRefresh } from '@/hooks/useCheckin';

export default function TenantAccountSettings() {
  return <AccountSettings onPasswordChanged={notifyCheckinRefresh} />;
}
