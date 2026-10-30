// Manifest for the doctors app — discovered by FOM's loadTenantApps()
// when a tenant lists "doctors" in its `apps` array in tenants.json.
module.exports = {
  name: 'doctors',
  routes: require('./routes'),
  savedQueries: require('./savedQueries'),
  seed: require('./seed'),
};
