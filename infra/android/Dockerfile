# Docker Hub TLS is unavailable from campus-server. The proxy image is pinned
# to the Ubuntu 26.04 manifest digest instead of trusting a floating tag.
FROM docker.m.daocloud.io/library/ubuntu:26.04@sha256:b7f48194d4d8b763a478a621cdc81c27be222ba2206ca3ca6bc42b49685f3d9e

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=22.23.1
ARG NODE_SHA256=9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578
ARG PNPM_VERSION=9.15.0
ARG ANDROID_COMMAND_LINE_TOOLS=13114758
ARG ANDROID_COMMAND_LINE_TOOLS_SHA1=5fdcc763663eefb86a5b8879697aa6088b041e70
ARG ANDROID_NDK_VERSION=27.1.12297006
ARG RUST_VERSION=1.88.0
ARG MAESTRO_VERSION=2.6.1
ARG FASTLANE_VERSION=2.235.0
ARG BUNDLETOOL_VERSION=1.18.3
ARG BUNDLETOOL_SHA256=a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    PNPM_HOME=/opt/pnpm \
    CARGO_HOME=/opt/cargo \
    RUSTUP_HOME=/opt/rustup \
    BUNDLETOOL_JAR=/opt/bundletool/bundletool.jar \
    AVD_NAME=zero-vault-api36 \
    PATH=/opt/pnpm:/opt/cargo/bin:/opt/maestro/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/emulator:/opt/android-sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin:/usr/local/bin:/usr/bin:/bin

RUN sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
      /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update \
    && apt-get install -y --no-install-recommends \
      aria2 ca-certificates curl git jq rsync unzip zip xz-utils openssh-client \
      openjdk-17-jdk-headless build-essential pkg-config clang cmake ninja-build ruby-full ruby-dev \
      libnss3 libx11-6 libxcb1 libdbus-1-3 libfontconfig1 libxcomposite1 \
      libxcursor1 libxi6 libxtst6 libxrandr2 libxkbfile1 libasound2t64 libpulse0 \
      libgl1 libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

RUN aria2c --allow-overwrite=true --auto-file-renaming=false --continue=true \
      --file-allocation=none --max-connection-per-server=16 --split=16 \
      --min-split-size=1M --max-tries=10 --retry-wait=5 \
      --checksum="sha-256=${NODE_SHA256}" \
      --dir=/tmp --out="node-v${NODE_VERSION}-linux-x64.tar.xz" \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && tar -xJf "/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
    && rm "/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && aria2c --allow-overwrite=true --auto-file-renaming=false --continue=true \
      --file-allocation=none --max-connection-per-server=16 --split=16 \
      --min-split-size=1M --max-tries=10 --retry-wait=5 \
      --checksum="sha-1=${ANDROID_COMMAND_LINE_TOOLS_SHA1}" \
      --dir=/tmp --out=android-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMAND_LINE_TOOLS}_latest.zip" \
    && unzip -q /tmp/android-tools.zip -d /tmp/android-tools \
    && mv /tmp/android-tools/cmdline-tools "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm -rf /tmp/android-tools /tmp/android-tools.zip \
    && yes | sdkmanager --licenses >/dev/null \
    && for package in \
      "platform-tools" \
      "platforms;android-36" \
      "build-tools;36.0.0" \
      "ndk;${ANDROID_NDK_VERSION}" \
      "cmake;3.22.1" \
      "emulator"; do \
        installed=false; \
        for attempt in 1 2 3 4 5; do \
          if sdkmanager "${package}"; then installed=true; break; fi; \
          sleep 5; \
        done; \
        test "${installed}" = true || exit 1; \
      done

# Only the latest pinned Android API is used for emulator and instrumented
# coverage. minSdk remains an install-compatibility declaration.
RUN for attempt in 1 2 3; do sdkmanager "system-images;android-36;google_apis;x86_64" && exit 0; rm -rf /root/.android/cache "${ANDROID_HOME}/.temp"; done; exit 1

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rustup target add aarch64-linux-android x86_64-linux-android \
    && cargo install cargo-ndk --version 4.1.2 --locked

RUN curl -fsSLo /tmp/maestro.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip" \
    && unzip -q /tmp/maestro.zip -d /opt \
    && rm /tmp/maestro.zip

RUN mkdir -p /opt/bundletool \
    && curl --retry 5 --retry-all-errors -fsSLo "${BUNDLETOOL_JAR}" \
      "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar" \
    && echo "${BUNDLETOOL_SHA256}  ${BUNDLETOOL_JAR}" | sha256sum -c - \
    && chmod 0444 "${BUNDLETOOL_JAR}" \
    && printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -euo pipefail' \
      'exec java -jar "${BUNDLETOOL_JAR:?BUNDLETOOL_JAR is required}" "$@"' \
      > /usr/local/bin/bundletool \
    && chmod 0755 /usr/local/bin/bundletool \
    && test "$(bundletool version)" = "${BUNDLETOOL_VERSION}"

ARG MULTI_JSON_VERSION=1.21.1
# Retained to preserve the already-cached campus-server image layers. The
# personal APK workflow does not invoke fastlane or any Play publishing path.
RUN gem install multi_json --version "${MULTI_JSON_VERSION}" --no-document \
    && gem install fastlane --version "${FASTLANE_VERSION}" --no-document

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Expo/AGP still resolves one transitive Android module with Build Tools 35,
# while the app itself compiles and targets API 36 with Build Tools 36.
ARG ANDROID_BUILD_TOOLS_35_SHA1=2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc
RUN aria2c --allow-overwrite=true --auto-file-renaming=false \
      --file-allocation=none --max-connection-per-server=16 --split=16 \
      --min-split-size=1M \
      --checksum="sha-1=${ANDROID_BUILD_TOOLS_35_SHA1}" \
      --dir=/tmp --out=build-tools_r35_linux.zip \
      https://dl.google.com/android/repository/build-tools_r35_linux.zip \
    && mkdir -p /tmp/build-tools-r35 \
    && unzip -q /tmp/build-tools_r35_linux.zip -d /tmp/build-tools-r35 \
    && grep -Eq '^Pkg.Revision *= *35.0.0$' /tmp/build-tools-r35/android-15/source.properties \
    && mv /tmp/build-tools-r35/android-15 "${ANDROID_HOME}/build-tools/35.0.0" \
    && rm -rf /tmp/build-tools-r35 /tmp/build-tools_r35_linux.zip \
    && "${ANDROID_HOME}/build-tools/35.0.0/aapt2" version

# Keep additions after the large, stable SDK/NDK/emulator layers so an
# environment-only update does not force campus-server to download them again.
ARG CLOUDFLARED_VERSION=2026.7.2
ARG CLOUDFLARED_SHA256=ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd
RUN curl --retry 5 --retry-all-errors -fsSLo /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" \
    && echo "${CLOUDFLARED_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/cloudflared \
    && cloudflared --version

COPY --chmod=0555 scripts/mobile-sign-play-aab.sh /opt/zero-vault-release/mobile-sign-play-aab.sh
RUN test "$(stat -c '%u:%g:%a' /opt/zero-vault-release/mobile-sign-play-aab.sh)" = 0:0:555

WORKDIR /workspace
CMD ["sleep", "infinity"]
