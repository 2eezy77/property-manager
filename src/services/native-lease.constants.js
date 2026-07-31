'use strict';

const PROPERTY_ADDRESS = {
  line1: '743 A Ave',
  city: 'Norfolk',
  state: 'VA',
  zip: '23504',
  full: '743 A Ave, Norfolk, VA 23504',
};

const LEASE_PARTIES = {
  landlords: [
    { name: 'Jose Isaac Montero' },
    { name: 'Trevor McManas' },
  ],
  propertyManager: {
    name: 'Konstantin Patchell Hazlett',
    title: 'Property Manager (as agent for Landlord)',
  },
};

const ROOM_DEFAULTS = {
  regular: { monthlyRent: 900, securityDeposit: 900 },
  master:  { monthlyRent: 1200, securityDeposit: 1200 },
};

const SHARED_DEFAULTS = {
  gracePeriodDays: 0,
  lateFeeType: 'flat',
  lateFeeAmount: 150,
  nsfFee: 50,
};

function defaultTermsForRoomType(roomType) {
  const key = String(roomType || '').toLowerCase();
  const room = ROOM_DEFAULTS[key];
  if (!room) {
    const err = new Error(`Unsupported room type: ${roomType}`);
    err.code = 'INVALID_ROOM_TYPE';
    throw err;
  }
  return {
    roomType: key,
    monthlyRent: room.monthlyRent,
    securityDeposit: room.securityDeposit,
    gracePeriodDays: SHARED_DEFAULTS.gracePeriodDays,
    lateFeeType: SHARED_DEFAULTS.lateFeeType,
    lateFeeAmount: SHARED_DEFAULTS.lateFeeAmount,
    nsfFee: SHARED_DEFAULTS.nsfFee,
  };
}

module.exports = {
  PROPERTY_ADDRESS,
  LEASE_PARTIES,
  ROOM_DEFAULTS,
  SHARED_DEFAULTS,
  defaultTermsForRoomType,
};
