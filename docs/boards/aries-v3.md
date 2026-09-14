# C-DAC ARIES v3.0 RISC-V Development Board

> **Date Added to Logicraft Studios Simulator:** 11-09-2026  
> **Target Architecture:** RISC-V 32-bit (RV32IM)  
> **System-on-Chip (SoC):** C-DAC THEJAS32 / VEGA ET1031 @ 100 MHz  
> **Arduino FQBN:** `vega:riscv:aries_v3`  

---

## 1. Overview

The **C-DAC ARIES v3.0** is an indigenous, open-hardware microcontroller development board designed and developed by the **Centre for Development of Advanced Computing (C-DAC)**, India, as part of the Digital India RISC-V (DIR-V) program.

It is powered by the **THEJAS32 SoC**, which integrates the high-performance **VEGA ET1031** 32-bit RISC-V core operating at up to 100 MHz. In Logicraft Studios, the board is simulated cycle-accurately in the browser with support for the native GCC RISC-V cross-compilation toolchain, Motorola S-record (SREC) firmware loading, dual-row header pin snapping, onboard heartbeat and RGB LED indicators, and full SPICE circuit integration.

---

## 2. Technical Specifications

| Parameter | Description |
| :--- | :--- |
| **Microprocessor** | C-DAC THEJAS32 SoC |
| **Core Architecture** | VEGA ET1031 32-bit RISC-V (RV32IM: Base Integer + Integer Multiplication & Division) |
| **Clock Speed** | 100 MHz |
| **Internal SRAM** | 256 KB on-chip SRAM |
| **External Flash** | 2 MB SPI Flash |
| **Operating Voltage** | 3.3 V DC logic level |
| **Input Voltage** | 5 V via USB-C or 7–12 V via DC Barrel Jack |
| **Digital I/O Pins** | 32 GPIOs (GPIO0 – GPIO31) |
| **PWM Channels** | 8 hardware PWM outputs (PWM0 – PWM7) |
| **Analog ADC** | 4 Channels, 10-bit resolution (A0 – A3 / ADC_CH0 – ADC_CH3) |
| **UART Interfaces** | 3× UART (UART0: Serial Monitor, UART1: Pins, UART2: Auxiliary header) |
| **I²C Interfaces** | 2× I²C (I2C0 on header J10, I2C1 on header J1) |
| **SPI Interfaces** | 3× SPI (SPI0 on J1, SPI1 on J7, SPI2 on J4) |
| **Onboard Indicators** | LD4 (Processor Heartbeat - Orange), LD1 (RGB LED - Active-Low) |
| **Form Factor** | Extended Arduino Uno footprint with dual-row pin headers |
| **Integration Date** | **11-09-2026** |

---

## 3. Onboard LEDs & Indicators

The ARIES v3.0 features two dedicated status LEDs located on the left side of the THEJAS32 processor:

### 3.1 Processor Heartbeat LED (`LD4` / `PROC BEAT`)
* **Color:** Orange
* **Function:** Indicates that the RISC-V CPU core and master clock are active.
* **Simulator Behavior:** Automatically pulses with a 1 Hz heartbeat animation whenever the simulation is running.

### 3.2 Built-in RGB LED (`LD1`)
* **Color:** Multi-color RGB (Red, Green, Blue channels)
* **Control Logic:** **Active-Low** (`LOW` turns the segment ON, `HIGH` turns it OFF).
* **Pin Assignments:**
  * **Green Channel:** `GPIO22` (also maps to `LED_BUILTIN`)
  * **Blue Channel:** `GPIO23`
  * **Red Channel:** `GPIO24`
* *Note:* Pins 22, 23, and 24 are dedicated internally to LD1 and are not exposed on the external dual-row headers.

---

## 4. Pinout & Header Mapping

The board provides 64 primary header slots arranged in dual-row configurations:

### Right-Hand Headers

#### Header J1 (Top-Right Inner Column — 10 Pins)
* Slot 1: `I2C1_SCL` (SCL1)
* Slot 2: `I2C1_SDA` (SDA1)
* Slot 3: `NC`
* Slot 4: `GND`
* Slot 5: `SPI0_SCLK` (SCLK0)
* Slot 6: `SPI0_MISO` (MISO0)
* Slot 7: `SPI0_MOSI` (MOSI0)
* Slot 8: `SPI0_SS` (SS0)
* Slot 9: `PWM4` (~4)
* Slot 10: `PWM3` (~3)

#### Header J3 (Top-Right Outer Column — 8 Pins)
* Slot 1: `PWM7` (~7)
* Slot 2: `PWM6` (~6)
* Slot 3: `PWM5` (~5)
* Slot 4: `GPIO15` (D15)
* Slot 5: `GPIO14` (D14)
* Slot 6: `GPIO13` (D13)
* Slot 7: `GPIO12` (D12)
* Slot 8: `GPIO11` (D11)

#### Header J2 (Bottom-Right Dual-Row — 16 Pins)
* **Outer Row (GPIOs):**
  * `GPIO10`, `GPIO9`, `GPIO8`, `GPIO7`, `GPIO6`, `GPIO5`, `GPIO4`, `GPIO3`
* **Inner Row (PWM, GPIOs, UART1):**
  * `PWM2` (~2), `PWM1` (~1), `PWM0` (~0), `GPIO2` (*2), `GPIO1` (*1), `GPIO0` (*0), `UART1_TX` (TX1), `UART1_RX` (RX1)

---

### Left-Hand Headers

#### Header J11 (Top-Left Outer Column — Power, 8 Pins)
* Slot 1: `NC`
* Slot 2: `IOREF`
* Slot 3: `RST` (Reset)
* Slot 4: `3V3` (3.3V Output)
* Slot 5: `5V` (5.0V Output)
* Slot 6: `GND`
* Slot 7: `GND`
* Slot 8: `VIN` (7–12V Input)

#### Header J9 (Top-Left Inner Column — GPIOs, 8 Pins)
* Slot 1: `GPIO31` (D31)
* Slot 2: `GPIO30` (D30)
* Slot 3: `GPIO29` (D29)
* Slot 4: `GPIO28` (D28)
* Slot 5: `GPIO27` (D27)
* Slot 6: `GPIO26` (D26)
* Slot 7: `GPIO25` (D25)
* Slot 8: `GND`

#### Header J10 (Bottom-Left Dual-Row — 12 Pins)
* **Outer Row (Analog ADC & I2C0):**
  * `A0` (ADC_CH0), `A1` (ADC_CH1), `A2` (ADC_CH2), `A3` (ADC_CH3), `I2C0_SDA` (SDA0), `I2C0_SCL` (SCL0)
* **Inner Row (GPIOs):**
  * `GPIO21`, `GPIO20`, `GPIO19`, `GPIO18`, `GPIO17`, `GPIO16`

---

### Auxiliary Headers & Controls

* **J14 (Power Source Selection):** `VIN`, `5V0`, `VCC_USB`
* **J12 (Boot Selection):** `BOOT_SEL`, `GND`
* **J7 (SPI1 Breakout):** 2×3 header (`SS1`, `SCLK1`, `MISO1`, `GND`, `MOSI1`, `3V3`)
* **J5 (UART2 Breakout):** 2×2 header (`3V3`, `TX2`, `GND`, `RX2`)
* **J4 (SPI2 Breakout):** 2×3 header (`3V3`, `MOSI2`, `MISO2`, `SCLK2`, `GND`, `SS2`)
* **Pushbutton:** Hardware Reset switch

---

## 5. Software Development & Compilation

### Toolchain Details
* **Platform:** `cdac:riscv` or `vega:riscv`
* **Architecture:** `riscv32-unknown-elf-gcc`
* **Optimization:** `-march=rv32im -mabi=ilp32`
* **Firmware Output Format:** Motorola S-record (`.srec`) or Intel HEX (`.hex`)

### Blink Example (Onboard RGB LED & GPIO10)

```cpp
/**
 * C-DAC ARIES v3.0 Blink Example
 * Added on: 11-09-2026
 */

#define LED_GREEN 22 // Built-in Green RGB channel (Active-Low)
#define LED_BLUE  23 // Built-in Blue RGB channel (Active-Low)
#define LED_RED   24 // Built-in Red RGB channel (Active-Low)
#define EXT_LED   10 // Header J2 Pin 10 (Active-High)

void setup() {
  Serial.begin(115200);
  Serial.println("ARIES v3.0 Simulation Initialized! (Added: 11-09-2026)");

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(EXT_LED, OUTPUT);

  // Turn off all RGB channels initially
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_BLUE, HIGH);
  digitalWrite(LED_RED, HIGH);
}

void loop() {
  // Turn ON Green channel and External Pin 10
  digitalWrite(LED_GREEN, LOW);
  digitalWrite(EXT_LED, HIGH);
  Serial.println("LED State: ON");
  delay(1000);

  // Turn OFF
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(EXT_LED, LOW);
  Serial.println("LED State: OFF");
  delay(1000);
}
```

### 5.2 OLED SSD1306 Display on I2C-1

The THEJAS32 SoC features two independent hardware I²C buses:
- **I²C-1** (`SDA1` / `SCL1` on Header J1): Select with `TwoWire Wire(1);`
- **I²C-0** (`I2C0_SDA` / `I2C0_SCL` on Header J10 Outer): Select with `TwoWire Wire(0);`

```cpp
// C-DAC ARIES v3.0 OLED SSD1306 Test
// Connect OLED: SDA -> SDA1, SCL -> SCL1, VCC -> 3.3V, GND -> GND

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

TwoWire Wire(1); // Required on VEGA ARIES v3 to select I2C-1 controller

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR  0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
  Serial.begin(115200);
  Wire.begin();

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("SSD1306 initialization failed");
    while (1);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("ARIES v3.0");
  display.setTextSize(1);
  display.setCursor(0, 30);
  display.println("Logicraft Studios");
  display.display();
}

void loop() {}
```

---

## 6. History & Changelog

* **11-09-2026**:
  * Initial board release in Logicraft Studios simulator.
  * Added `cdac_aries_v3_board_only.svg` vector representation with 100% exact pin slot alignment.
  * Added active-low onboard RGB LED (`LD1`) and 1 Hz orange pulsing Heartbeat LED (`LD4`).
  * Added full SPICE power rails (`3.3V` logic level, `5V` aux, `GND`).
  * Added auto-instantiation of `TwoWire Wire(1)` in compiler service to support standard Arduino I2C libraries seamlessly.
  * Created component datasheets and comprehensive documentation.

