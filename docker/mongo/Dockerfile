FROM ghcr.io/groupsky/homy/mongo:6.0.27

# ping needs no login. The start period covers journal recovery after a
# restore from a (crash-consistent) deploy snapshot.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD ["mongosh", "--quiet", "--norc", "--eval", "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)"]
