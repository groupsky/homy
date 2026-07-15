FROM ghcr.io/groupsky/homy/wireguard:1.0.20260223-r0-ls117

# This linuxserver image only writes a [Peer] block for peers whose name matches
# ^[[:alnum:]]+$ (still true as of ls117), silently skipping any name containing
# '-' or '_'. Our peers use hyphens (geno-laptop, tania-phone, ...), so every generate_confs run
# (triggered by any PEERS change) rebuilt wg0.conf with ONLY the alphanumeric
# peers, dropping the rest and breaking their VPN. Relax the guard to allow '-'
# and '_'. The grep assertion fails the build if a future base-image bump moves
# or removes the guard, so the fix can't silently regress.
RUN CONF_RUN=/etc/s6-overlay/s6-rc.d/init-wireguard-confs/run \
    && sed -i 's/alnum:]]+/alnum:]_-]+/' "$CONF_RUN" \
    && grep -q 'alnum:]_-]+' "$CONF_RUN"
