# Invalid base image - contains RUN command (should be rejected)
FROM node:18.20.8-alpine

LABEL org.opencontainers.image.source=https://github.com/groupsky/homy

# This RUN command makes it invalid as a base image
RUN apk add --no-cache curl

CMD ["node"]
