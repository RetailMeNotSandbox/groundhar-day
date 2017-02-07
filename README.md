# GroundHAR Day

GroundHAR Day is a tool for doing rapid, reproducible performance experiments.

Given an HTTP Archive - or [HAR][] - GroundHAR Day simulates the observed
network environment inside a Docker container. This makes it possible to replay
the captured page load under different network conditions. More interestingly,
the HAR content can be edited directly to quickly and rigorously evaluate
different optimization ideas.

## Quick start

1. Build and run the Docker image

  ```sh
  docker build -t groundhar-day .
  docker run --privileged -it -p 9222:9222 --dns 192.168.1.100 groundhar-day
  ```
2. In the container, generate a configuration file from a HAR

  ```sh
  ./generate-mininet-config.js /opt/examples/lawnsea.com.har
  ```
3. Create the simulated environment

  ```sh
  ./start-mininet.py --config mininet-config.json
  ```
4. Run headless Chrome in the container

  ```
  docker exec -it <the name or hash of the running container> google-chrome-unstable --headless --disable-gpu --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --window-size=412,732
  ```
5. Open http://localhost:9222 in your browser and click on "about:blank"
6. Type `http://lawnsea.com` into the headless browser's URL bar

[HAR]: http://www.softwareishard.com/blog/har-12-spec/
