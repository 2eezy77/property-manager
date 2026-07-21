require('../src/config/env');
const { runDailyRentBilling } = require('../src/services/rent-billing.service');

runDailyRentBilling()
  .then(result => {
    console.log('Done:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
