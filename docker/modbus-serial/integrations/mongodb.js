const { MongoClient } = require('mongodb')
const { connectWithRetry } = require('../mongo-connect')

module.exports = ({ url, options, collection }) => {
  let col

  // Readings that arrive before the connection is up are not inserted.
  connectWithRetry({ connect: () => MongoClient.connect(url, { ...options }) })
    .then((mongoClient) => {
      col = mongoClient.db().collection(collection)
    })

  const logger = (entry) => {
    if (col) {
      col.insertOne(entry)
        .catch((err) => {
          console.error('Error logging entry', err)
        })
    }
  }

  logger.toString = () => 'mongodb'

  return { publish: logger }
}
