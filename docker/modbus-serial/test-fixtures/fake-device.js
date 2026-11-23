// A device driver that needs no bus: for the service test in index.shutdown.test.js.
// It reports each read on stdout, so the test knows a point is in the batch.
module.exports = {
  read: async () => {
    console.log('read')
    return {v: 230}
  },
}
