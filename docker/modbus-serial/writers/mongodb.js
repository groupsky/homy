const { MongoClient } = require('mongodb')

module.exports = ({ url, options, collection }) => {
  let col

  MongoClient
    .connect(url, options)
    .then((mongoClient) => {
      const db = mongoClient.db()
      col = db.collection(collection)
    })

  const logger = (entry) => {
    if (col) {
      col.insert(entry)
    }
  }

  logger.toString = () => 'mongodb'

  return logger
}
