# The tavern in a container: the released Linux binary on Debian, the library in /data, listening on every
# interface of the container (publish it as -p 127.0.0.1:7777:7777 to keep it on this machine).
# Built by the release workflow from packages/server/dist/docker/<arch>/tavern; update by pulling a new image.
FROM debian:bookworm-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY docker/${TARGETARCH}/tavern /usr/local/bin/tavern
ENV TAVERN_DATA=/data TAVERN_BIND=0.0.0.0 TAVERN_CHANNEL=docker
VOLUME /data
EXPOSE 7777
ENTRYPOINT ["tavern"]
CMD ["start", "--no-open"]
