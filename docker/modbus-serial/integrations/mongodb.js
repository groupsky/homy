const { MongoClient } = require('mongodb')

module.exports = ({ url, options, collection }) => {
  let col

  MongoClient
    .connect(url, {
      ...options,
    })
    .then((mongoClient) => {
      const db = mongoClient.db()
      col = db.collection(collection)
    })
    .catch((err) => {
      console.error('Error initializing mongo connection', err)
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
