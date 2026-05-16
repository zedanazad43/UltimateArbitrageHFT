# Tools Configuration

Note: Empty or undefined fields such as GOBIN and toolsGopath can be normal depending on shell startup behavior and Go extension defaults.

## Refresh This Report

Run from hft folder:

    bash scripts/generate-tools-configuration.sh

## Environment

```text
GOBIN: undefined
toolsGopath: 
gopath: /go
GOROOT: /usr/local/go
PATH: redacted (environment-dependent)
PATH (shell launched with): redacted (environment-dependent)
```

## Tools

```text
go: /usr/local/go/bin/go: go version go1.26.1 linux/amd64
gotests: /go/bin/gotests (gotests v1.9.0)
impl: /go/bin/impl
goplay: /go/bin/goplay
dlv: /go/bin/dlv (Delve Debugger)
gopls: /go/bin/gopls (golang.org/x/tools/gopls v0.21.1)
```

## Go env

Workspace Folder (UltimateArbitrageHFT): /workspaces/UltimateArbitrageHFT/hft

```text
AR='ar'
CC='gcc'
CGO_CFLAGS='-O2 -g'
CGO_CPPFLAGS=''
CGO_CXXFLAGS='-O2 -g'
CGO_ENABLED='1'
CGO_FFLAGS='-O2 -g'
CGO_LDFLAGS='-O2 -g'
CXX='g++'
GCCGO='gccgo'
GO111MODULE=''
GOAMD64='v1'
GOARCH='amd64'
GOAUTH='netrc'
GOBIN=''
GOCACHE='/home/codespace/.cache/go-build'
GOCACHEPROG=''
GODEBUG=''
GOENV='/home/codespace/.config/go/env'
GOEXE=''
GOEXPERIMENT=''
GOFIPS140='off'
GOFLAGS=''
GOGCCFLAGS='-fPIC -m64 -pthread -Wl,--no-gc-sections -fmessage-length=0 -ffile-prefix-map=/tmp/go-buildXXXX=/tmp/go-build -gno-record-gcc-switches'
GOHOSTARCH='amd64'
GOHOSTOS='linux'
GOINSECURE=''
GOMOD='/workspaces/UltimateArbitrageHFT/hft/go.mod'
GOMODCACHE='/go/pkg/mod'
GONOPROXY=''
GONOSUMDB=''
GOOS='linux'
GOPATH='/go'
GOPRIVATE=''
GOPROXY='https://proxy.golang.org,direct'
GOROOT='/usr/local/go'
GOSUMDB='sum.golang.org'
GOTELEMETRY='local'
GOTELEMETRYDIR='/home/codespace/.config/go/telemetry'
GOTMPDIR=''
GOTOOLCHAIN='auto'
GOTOOLDIR='/usr/local/go/pkg/tool/linux_amd64'
GOVCS=''
GOVERSION='go1.26.1'
GOWORK=''
PKG_CONFIG='pkg-config'
```
