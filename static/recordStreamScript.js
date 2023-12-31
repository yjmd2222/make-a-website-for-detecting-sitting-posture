const MODEL_PATH = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4';

const video = document.getElementById('webcam');
const liveView = document.getElementById('view');
const demosSection = document.getElementById('demos');
const enableWebcamButton = document.getElementById('webcamButton');

// Check if webcam access is supported.
function getUserMediaSupported() {
    return !!(navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia);
}


// If webcam supported, add event listener to button for when user
// wants to activate it to call enableCam function which we will 
// define in the next step.
if (getUserMediaSupported()) {
    enableWebcamButton.addEventListener('click', enableCam)
    enableWebcamButton.addEventListener('click', loadAndRunModel)
}
else {
    console.warn('getUserMedia() is not supported by your browser');
}

let posture;

async function loadAndRunModel() {
    posture = document.getElementById('posture');
    let movenet = await tf.loadGraphModel(MODEL_PATH, {
        fromTFHub: true
    });
    let exampleInputTensor = tf.zeros([1, 192, 192, 3], 'int32');

    let n = 0;
    let flattenBulk = [];

    setInterval(async function() {


        tf.engine().startScope();
        let imageTensor = tf.browser.fromPixels(video);
        const [wHeight, wWidth] = imageTensor.shape;

        let predictions = await predictWebcam();


        let bLeft = parseInt(predictions.bbox[0]);
        let bTop = parseInt(predictions.bbox[1]);
        let bWidth = parseInt(predictions.bbox[2]);
        let bHeight = parseInt(predictions.bbox[3]);
        if (bWidth > wWidth - bLeft) {
            bWidth = wWidth - bLeft
        }; // right of the image
        if (bHeight > wHeight - bTop) {
            bHeight = wHeight - bTop
        }; // bottom of the image
        if (bLeft < 0) {
            bLeft = 0
        }; // left of the image
        if (bTop < 0) {
            bTop = 0
        }; // top
        if (bHeight > bWidth) {
            bHeight = bWidth
        }; // if height > width, cut the height from bottom
        let cropStartPoint = [bTop, bLeft, 0]; // red
        let cropSize = [bHeight, bWidth, 3] // all RGB

        let padAmount;
        let padDirection;

        if (bWidth > bHeight) {
            padAmount = bWidth - bHeight; // most likely not needed
            padDirection = 'y'
        } else if (bWidth < bHeight) {
            padAmount = bHeight - bWidth;
            padDirection = 'x'
        }

        let croppedTensor = tf.slice(imageTensor, cropStartPoint, cropSize);

        let paddedTensor;
        let resizedTensor;

        if (padDirection == 'x') {
            paddedTensor = croppedTensor.pad([
                [0, padAmount],
                [0, 0],
                [0, 0]
            ])
        } else if (padDirection == 'y') {
            paddedTensor = croppedTensor.pad([
                [0, 0],
                [0, padAmount],
                [0, 0]
            ])
        } else {
            paddedTensor = croppedTensor
        }
        
        resizedTensor = tf.image.resizeBilinear(paddedTensor, [192, 192], true).toInt();

        let tensorOutput = movenet.predict(tf.expandDims(resizedTensor));
        let arrayOutput = await tensorOutput.array();
        const singlePoint = arrayOutput[0][0]; // 17, 3

        const yPoint = singlePoint.map(row => row[0]);
        const xPoint = singlePoint.map(row => row[1]);

        const flatten = [];
        for (let i = 0; i < yPoint.length; i++) {
            flatten.push(yPoint[i], xPoint[i]);
        }

        flattenBulk.push(flatten);
        if (flattenBulk.length == 10) {
            sendPostRequest(flattenBulk);
            flattenBulk.length = 0;
        }
        
        tf.engine().endScope();
        
        n++;

    }, 200);

};

// Enable the live webcam view and start classification.
async function enableCam(event) {
    // Only continue if the COCO-SSD has finished loading.
    if (!model) {
        return;
    }

    // Hide the button once clicked.
    event.target.classList.add('removed');

    // getUsermedia parameters to force video but not audio.
    const constraints = {
        video: true
    };
    let display = await navigator.mediaDevices
        .getUserMedia(constraints);

    // Returns a sequence of MediaStreamTrack objects 
    // representing the video tracks in the stream

    return new Promise((resolve) => {
        navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
            video.srcObject = stream;
        });
    });
}

// Store the resulting model in the global scope of our app.
var model = undefined;

// Before we can use COCO-SSD class we must wait for it to finish
// loading. Machine Learning models can be large and take a moment 
// to get everything needed to run.
// Note: cocoSsd is an external object loaded from our index.html
// script tag import so ignore any warning in Glitch.
cocoSsd.load().then(function(loadedModel) {
    model = loadedModel;
    // Show demo section now model is ready to use.
    demosSection.classList.remove('invisible');
});

var children = [];



// display
function predictWebcam() {
    return new Promise((resolve) => {
        // Now let's start classifying a frame in the stream.
        model.detect(video).then(function(predictions) {
            // Remove any highlighting we did previous frame.
            for (let i = 0; i < children.length; i++) {
                liveView.removeChild(children[i]);
            }
            children.splice(0);

            // Now lets loop through predictions and draw them to the live view if
            // they have a high confidence score.
            for (let n = 0; n < predictions.length; n++) {
                // If we are over 66% sure we are sure we classified it right, draw it!
                if (predictions[n].score > 0.66) {
                    const p = document.createElement('p');
                    p.innerText = predictions[n].class + ' - with ' +
                        Math.round(parseFloat(predictions[n].score) * 100) +
                        '% confidence.';
                    p.style = 'margin-left: ' + predictions[n].bbox[0] + 'px; margin-top: ' +
                        (predictions[n].bbox[1] - 10) + 'px; width: ' +
                        (predictions[n].bbox[2] - 10) + 'px; top: 0; left: 0;';

                    const highlighter = document.createElement('div');
                    highlighter.setAttribute('class', 'highlighter');
                    highlighter.style = 'left: ' + predictions[n].bbox[0] + 'px; top: ' +
                        predictions[n].bbox[1] + 'px; width: ' +
                        predictions[n].bbox[2] + 'px; height: ' +
                        predictions[n].bbox[3] + 'px;';

                    liveView.appendChild(highlighter);
                    liveView.appendChild(p);
                    children.push(highlighter);
                    children.push(p);

                    // Resolve the promise with the current prediction
                    resolve(predictions[n]);
                }
            }
        });
    });
}


// 주기적으로 POST 요청을 보내는 함수
async function sendPostRequest(output) {
    // POST 요청을 보낼 데이터를 준비합니다.
    var data = {
        "movenet_output": output,
        "posture": posture.value,
        "location": 'stream'
    };
    // POST 요청을 보냅니다.
    fetch('/record-post-endpoint', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.text())
        .then(result => console.log(result))
        .catch(error => console.error(error));
}
