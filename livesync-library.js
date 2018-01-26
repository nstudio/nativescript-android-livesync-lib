let net = require('net'),
    fs = require('fs'),
    path = require('path'),
    adbInterface = require('./adb-interface.js')

module.exports = (function () {
    let socketConnection,
        serverIsReadyToListen = false,
        baseDir

    const DEFAULT_PORT = 18182,
        DELETE_FILE_OPERATION = 7,
        CREATE_FILE_OPERATION = 8,
        DO_SYNC_OPERATION = 9

    function init(configurations) {
        if (!configurations.fullApplicationName) {
            throw new Error(`You need to provide "fullApplicationName" as a configuration propery!`)
        }
        if (!configurations.baseDir) {
            throw new Error(`You need to provide "baseDir" as a configuration property!`)
        }

        let localHostPort = configurations.port ? configurations.port : DEFAULT_PORT,
            localHostAddress = configurations.address ? configurations.address : '127.0.0.1',
            adbForwardSuffix = configurations.adbForwardSuffix ? configurations.adbForwardSuffix : '',
            fullApplicationName = configurations.fullApplicationName,
            socket = new net.Socket()

        baseDir = configurations.baseDir

        return adbInterface
            .init(configurations)
            .then(adbInitializedCallback, adbNotInitializedCallback)

        function adbInitializedCallback(data) {
            return new Promise(function (resolve, reject) {
                socketConnection = socket.connect(localHostPort, localHostAddress)

                // socketConnection.allowHalfOpen = true

                socketConnection.on('data', function (data) {
                    serverIsReadyToListen = true
                    resolve(socketConnection)
                })

                socketConnection.on('close', function (had_error) {
                    let error = new Error('Server socket is closed!')
                    if (serverIsReadyToListen) {
                        console.log('Server socket closed!')
                    }
                    if (had_error) {
                        error = new Error('Socket had a transmission error')
                        if (configurations.errorHandler) {
                            configurations.errorHandler(error)
                        }
                    }
                })

                socketConnection.on('error', function (err) {
                    serverIsReadyToListen = false
                    let error = new Error(`Socket Error:\n${err}`)
                    if (configurations.errorHandler) {
                        configurations.errorHandler(error)
                    }
                })
            })
        }

        function adbNotInitializedCallback(err) {
            return new Promise(function (resolve, reject) {
                console.log('This tool expects a connected device or emulator!')
                reject(err)
            })
        }
    }

    function sendFile(fileName) {
        return new Promise(function (resolve, reject) {
            var relativeFileName = path.relative(baseDir, fileName)
            var fileNameLength = _getSanatizedStringLength(relativeFileName, 5),
                fileContent = fs.readFileSync(fileName),
                fileContentLength = _getSanatizedStringLength(fileContent, 10)

            function writeDone() {
                resolve(true)
            }

            if (serverIsReadyToListen) {
                console.log(`Sending file: ${fileName}`)
                socketConnection.write(`${CREATE_FILE_OPERATION}${fileNameLength}${relativeFileName}${fileContentLength}${fileContent}`, writeDone)
            }
        })
    }

    function deleteFile(fileName) {
        return new Promise(function (resolve, reject) {
            var fileNameLength = _getSanatizedStringLength(fileName, 5)

            function writeDone(a, s, d) {
                resolve(a)
            }

            if (serverIsReadyToListen) {
                socketConnection.write(`${DELETE_FILE_OPERATION}${fileNameLength}${fileName}`, writeDone)
            }
        })
    }

    function sendDirectory(dir) {
        return new Promise(function (resolve, reject) {
            _traverseDir(dir, function (err, list) {
                if (err) {
                    reject(err)
                }
                resolve(list)
            })
        })
    }

    function sendFilesArray(filesArr) {
        return new Promise(function (resolve, reject) {
            let sendFilePromises = []
            filesArr.forEach(file => {
                if (!fs.existsSync(file)) {
                    let err = new Error(`${file} doesn't exist.\nThis tool works only with absolute paths!`)
                    return reject(err)
                }
                sendFilePromises.push(sendFile(file))
            })
            Promise.all(sendFilePromises)
                .then(function () {
                    sendDoSyncOperation()
                        .then(function () {
                            resolve(true)
                        }, function (err) {
                            return reject(`Failed to send do sync operation: \n${err}`)
                        })
                }, function (err) {
                    return reject(`Failed to send files array: \n${err}`)
                })
        })
    }

    function sendDoSyncOperation() {
        return new Promise(function (resolve, reject) {
            function writeDone() {
                resolve(true)
            }
            socketConnection.write(`${DO_SYNC_OPERATION}`, writeDone)
        })
    }

    function end() {
        socketConnection.end()
    }

    function _getSanatizedStringLength(input, biteLength) {
        var arr = new Array(biteLength)
        var initialString = arr.join('0')
        return (initialString + input.length).substr(-biteLength)
    }

    function _traverseDir(dir, done) {
        var results = []
        fs.readdir(dir, function (err, list) {
            if (err) {
                return done(err)
            }
            var remaining = list.length
            if (!remaining) {
                return done(null, results)
            }
            list.forEach(function (file) {
                file = path.resolve(dir, file)
                fs.stat(file, function (err, stat) {
                    if (stat && stat.isDirectory()) {
                        _traverseDir(file, function (err, res) {
                            results = results.concat(res)
                            if (!--remaining) {
                                if (done instanceof Function) {
                                    done(null, results)
                                }
                            }
                        })
                    } else {
                        results.push(file)
                        sendFile(file)
                        if (!--remaining) {
                            done(null, results)
                        }
                    }
                })
            })
        })
    }

    return {
        init: init,
        sendFile: sendFile,
        deleteFile: deleteFile,
        sendDirectory: sendDirectory,
        sendFilesArray: sendFilesArray,
        sendDoSyncOperation, sendDoSyncOperation,
        end: end
    }
})()