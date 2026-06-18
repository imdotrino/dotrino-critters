# Imagen Lambda de render de critters: Blender headless (CPU) + handler Python.
# BUILD desde la RAIZ del repo:  docker build --network=host -f tools/lambda/Dockerfile -t critters-render .
#   (--network=host hace falta si el build no resuelve DNS al re-ejecutar la capa dnf —
#    pasa cuando la imagen base se actualiza e invalida el cache.)
# Prueba local (RIE incluido en la base):
#   docker run --rm -p 9000:8080 -e DRY_RUN=1 critters-render
#   curl -s http://localhost:9000/2015-03-31/functions/function/invocations \
#        -d '{"id":"g:demo:fuego:dps:2:0:0:6:1:1:0:1","views":["top"],"samples":64,"res":512}'
FROM public.ecr.aws/lambda/python:3.12

# libs que Blender enlaza aunque corra --background (sin display)
RUN dnf install -y libX11 libXi libXxf86vm libXfixes libXrender libxkbcommon \
        libSM libICE mesa-libGL xz tar && dnf clean all

# Blender oficial (trae Cycles CPU + denoiser OIDN); misma version que el dev local
ARG BLENDER_URL=https://download.blender.org/release/Blender4.0/blender-4.0.2-linux-x64.tar.xz
RUN curl -sL ${BLENDER_URL} -o /tmp/blender.txz \
    && mkdir -p /opt && tar -xJf /tmp/blender.txz -C /opt \
    && mv /opt/blender-* /opt/blender && rm /tmp/blender.txz

RUN pip install --no-cache-dir pillow boto3

# generador (los mismos scripts versionados del repo) + handler
COPY tools/blender/critter3d.py tools/blender/critter3d_mecha.py tools/blender/critter3d_gundam.py \
     tools/blender/critter3d_zoids.py tools/blender/critter3d_panzer.py tools/blender/critter3d_chimera.py \
     tools/blender/critter3d_cams.py tools/blender/critter3d_legs.py ${LAMBDA_TASK_ROOT}/blender/
COPY tools/lambda/handler.py tools/lambda/spec_derive.py ${LAMBDA_TASK_ROOT}/

ENV BLENDER=/opt/blender/blender \
    CRITTER_DENOISE=1 \
    BUCKET=s3.dotrino.com \
    PREFIX=critters/

CMD ["handler.lambda_handler"]
