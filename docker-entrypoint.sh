#!/bin/sh
set -e

# When the container starts as root (the default), take ownership of the
# bind-mounted /config so the app can read and write config.yaml regardless of
# the host directory's original uid/gid, then drop to the unprivileged app
# user. This means self-hosters never have to chown the bind mount themselves.
#
# If the container was started as a non-root user (e.g. a `user:` override in
# compose), we can't chown — just run the command as the current user.
if [ "$(id -u)" = "0" ]; then
  chown -R nextjs:nodejs /config 2>/dev/null || true
  exec su-exec nextjs:nodejs "$@"
fi

exec "$@"
