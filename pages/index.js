import Head from 'next/head'
import Image from 'next/image'
import styles from '../styles/Home.module.css'

import { useState } from 'react'

import { Heading, Text, HStack, VStack, Button, Divider, Input } from '@chakra-ui/react'
import {
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
} from '@chakra-ui/react'

const MAX_CHARACTERISTIC_SIZE = 512

const costumeControllerServiceUUID = '47191881-ebb3-4a9f-9645-3a5c6dae4900'
const textDisplayServiceUUID = 'aafca82b-95ae-4f33-9cf3-7ee0ef15ddf4'
const textDisplayServiceTextCharacteristicUUID = 'c5b56d2e-b6e9-49c7-b098-5af9a75f46cd'
const textDisplayServiceBrightnessCharacteristicUUID = '48387eca-eedf-40ee-ab37-b4fb3a18cdf1'
const costumeControllerFwVersionCharacteristicUUID = '55cf24c7-7a28-4df4-9b53-356b336bab71'
const costumeControllerOTADataCharacteristicUUID = '1083b9a4-fdc0-4aa6-b027-a2600c8837c4'
const costumeControllerOTAControlCharacteristicUUID = 'd1627dbe-b6ae-421f-b2eb-5878576410c0'

const OTA_CONTROL_NOP   = 0x00
const OTA_CONTROL_ACK   = 0x01
const OTA_CONTROL_NACK  = 0x02
const OTA_CONTROL_START = 0x04
const OTA_CONTROL_END   = 0x08
const OTA_CONTROL_ERR   = 0xFF

const deviceRequestConfig = {
  filters: [{ services: [costumeControllerServiceUUID] }],
  optionalServices: [textDisplayServiceUUID]
}

let costumeController
let textDisplayService

async function connectBLE () {
  const costume = await navigator.bluetooth.requestDevice(deviceRequestConfig)
  console.log(costume.name)

  const gattServer = await costume.gatt.connect()
  costumeController = await gattServer.getPrimaryService(costumeControllerServiceUUID)
  textDisplayService = await gattServer.getPrimaryService(textDisplayServiceUUID)

  const decoder = new TextDecoder('utf-8')
  const currentText = decoder.decode(await (await textDisplayService.getCharacteristic(textDisplayServiceTextCharacteristicUUID)).readValue())
  console.log(currentText)
}

async function sendText(text) {
  console.log(`Trying to update text to ${text}`)

  const encoder = new TextEncoder()
  
  const textCharacteristic = await textDisplayService.getCharacteristic(textDisplayServiceTextCharacteristicUUID)
  textCharacteristic.writeValue(encoder.encode(text))
}

async function sendBrightness(brightness) {
  console.log(`Trying to update brightness to ${brightness}`)
  
  const brightnessCharacteristic = await textDisplayService.getCharacteristic(textDisplayServiceBrightnessCharacteristicUUID)
  brightnessCharacteristic.writeValue(Uint8Array.of(brightness))
}

async function updateFirmware(setProgress) {
  if (!costumeController) {
    console.log('!! NOT CONNECTED !!')
    return
  }

  const fwVersion = await (await costumeController.getCharacteristic(costumeControllerFwVersionCharacteristicUUID)).readValue()
  const currentVersion = fwVersion.getUint8(0)

  console.log(`Current version: ${currentVersion}`)
  
  const manifest = await (await fetch(`http://mw4-firmware-release.s3-website-us-east-1.amazonaws.com/deployment.json`)).json()
  console.log(manifest)

  if (manifest.version > currentVersion) {
    console.log(`Beginning BLE update`)
    const res = await fetch(`http://${manifest.host}${manifest.bin}`)
    const fw = await res.arrayBuffer()

    let remaining = fw.byteLength
    let curPos = 0

    const otaDataCharacteristic = await costumeController.getCharacteristic(costumeControllerOTADataCharacteristicUUID)
    const otaControlCharacteristic = await costumeController.getCharacteristic(costumeControllerOTAControlCharacteristicUUID)
    await otaControlCharacteristic.startNotifications()
    otaControlCharacteristic.addEventListener('characteristicvaluechanged', async evt => {
      const msg = evt.target.value
      if (msg.getUint8(0) !== OTA_CONTROL_ACK) {
        throw new Error(`Device did not respond to OTA_CONTROL_START with OTA_CONTROL_ACK!`)
      }

      await otaControlCharacteristic.writeValueWithResponse(Uint8Array.of(OTA_CONTROL_NOP))

      while (remaining > 0) {
        const sz = remaining >= MAX_CHARACTERISTIC_SIZE ? MAX_CHARACTERISTIC_SIZE : remaining
        const data = fw.slice(curPos, curPos + sz)
        curPos += sz
        remaining -= sz

        const progress = Math.round(100 * (curPos/fw.byteLength)) + '%'
        
        await otaDataCharacteristic.writeValueWithResponse(data)
        setProgress(progress)
      }

      console.log("done sending OTA; sending OTA_CONTROL_END...")
      await otaControlCharacteristic.writeValueWithResponse(Uint8Array.of(OTA_CONTROL_END))  
    })

    await otaControlCharacteristic.writeValueWithResponse(Uint8Array.of(OTA_CONTROL_START))
    
    
    // while (remaining > 0) {
    //   const sz = remaining >= MAX_CHARACTERISTIC_SIZE ? MAX_CHARACTERISTIC_SIZE : remaining
    //   const data = fw.slice(curPos, curPos + sz)
    //   curPos += sz
    //   remaining -= sz

    //   const progress = Math.round(100 * (curPos/fw.byteLength)) + '%'
      
    //   await otaDataCharacteristic.writeValueWithResponse(data)
    //   setProgress(progress)
    // }
    // console.log("done sending OTA")
  } else {
    console.log(`Device is already running latest version`)
  }
}

export default function Home () {
  const [text, setText] = useState('')
  const [progress, setProgress] = useState('')
  
  return (
    <VStack w='40%' margin='auto' mt={10}>
      <Heading>MW4 updater</Heading>

      <Button onClick={() => {connectBLE()}}>Find device</Button>

      {/* <Text>Connected to device</Text> */}
      <HStack>
        <Input placeholder='Text to display' onChange={evt => setText(evt.target.value)} />
        <Button onClick={() => sendText(text)}>Send</Button>
      </HStack>

      <HStack>
      <NumberInput defaultValue={50} min={0} max={255} onChange={sendBrightness}>
        <NumberInputField />
        <NumberInputStepper>
          <NumberIncrementStepper />
          <NumberDecrementStepper />
        </NumberInputStepper>
      </NumberInput>
      </HStack>

      <Button onClick={() => updateFirmware(setProgress)}>Update firmware</Button>
      <Text>Progress: {progress}</Text>
    </VStack>
  )
}
