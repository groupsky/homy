# Single-stage build without HEALTHCHECK (based on grafana service)
FROM ghcr.io/groupsky/homy/grafana:9.5.21

USER root

COPY provisioning /etc/grafana/provisioning
COPY dashboards /var/lib/grafana/dashboards

RUN chown -R grafana:grafana /etc/grafana/provisioning

USER grafana

EXPOSE 3000
