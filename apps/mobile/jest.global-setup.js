// Pin every test run to East Africa Time (UTC+3), the app's primary market.
// This runs in Jest's parent process before workers start, so workers inherit
// it. Setting process.env.TZ inside a test file has no effect (Jest sandboxes
// process.env per file), which is why it lives here.
//
// It also keeps CI meaningful: GitHub runners are UTC, where local and UTC
// calendar dates never differ, so a getLocalDateString that regressed to
// toISOString() would otherwise pass there unnoticed.
module.exports = () => {
  process.env.TZ = "Africa/Kampala";
};
