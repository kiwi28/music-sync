FROM alpine:3.21

ARG PB_VERSION=0.28.1
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates curl unzip sqlite3

RUN curl -L "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
    -o /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /usr/local/bin/ \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN addgroup -S pb && adduser -S pb -G pb
RUN mkdir -p /pb_data && chown pb:pb /pb_data
# Store migrations outside the volume; entrypoint copies them in at startup
COPY pb_migrations/ /pb_migrations_src/
USER pb

VOLUME ["/pb_data"]
EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://127.0.0.1:8090/api/health

ENTRYPOINT ["/entrypoint.sh"]
