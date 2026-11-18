# The tavern in a container: the released Linux binary on distroless (glibc and CA certificates, no shell), the
# library in /data, listening on every interface of the container (publish it as -p 127.0.0.1:7777:7777 to keep it on
# this machine). No RUN step, so buildx assembles both architectures without emulating either. The release workflow
# stages docker/<amd64|arm64>/tavern; update by pulling a new image.
FROM gcr.io/distroless/cc-debian12
ARG TARGETARCH
COPY docker/${TARGETARCH}/tavern /usr/local/bin/tavern
ENV TAVERN_DATA=/data TAVERN_BIND=0.0.0.0 TAVERN_CHANNEL=docker
VOLUME /data
EXPOSE 7777
ENTRYPOINT ["tavern"]
CMD ["start", "--no-open"]
