---
brand: C-DAC (Centre for Development of Advanced Computing)
buy: https://vegaprocessors.in/devboards/ariesv3.html
---
# C-DAC ARIES v3.0 RISC-V Development Board

> **Added to Logicraft Studios Simulator on: 11-09-2026**

The **ARIES v3.0** is an indigenous Indian development board based on the **THEJAS32 SoC**, featuring the **VEGA ET1031** 32-bit RISC-V core (RV32IM) running at **100 MHz** with **256 KB SRAM** and **2 MB SPI Flash**.

### Quick Specifications

| Specification | Value |
| :--- | :--- |
| **SoC / Core** | C-DAC THEJAS32 / VEGA ET1031 (RISC-V RV32IM) |
| **Clock Frequency** | 100 MHz |
| **SRAM / Flash** | 256 KB internal SRAM, 2 MB external Flash |
| **Logic Level** | 3.3 V (I/O lines), 5 V compatible via DC barrel / USB-C |
| **Digital GPIO** | 32 GPIO pins (GPIO0 – GPIO31) |
| **PWM** | 8 PWM channels (PWM0 – PWM7) |
| **Analog ADC** | 4 ADC channels (A0 – A3 / ADC_CH0 – ADC_CH3) |
| **Communication** | 3× UART, 2× I²C, 3× SPI |
| **Added Date** | **11-09-2026** |

---

### Onboard LEDs & Hardware Indicators

1. **LD4 — Processor Heartbeat LED (`PROC BEAT`)**:
   - Dedicated orange hardware LED indicating CPU core activity.
   - Automatically pulses with a heartbeat rhythm in the simulator when the board is running.
2. **LD1 — Built-in RGB LED**:
   - Active-Low control logic (`LOW` = ON, `HIGH` = OFF).
   - **Green Channel:** `GPIO22` / `LED_BUILTIN`
   - **Blue Channel:** `GPIO23`
   - **Red Channel:** `GPIO24`

---

### Pinout Summary

| Header | Pins | Signals / Functions |
| :--- | :--- | :--- |
| **J1** (Top-Right Inner) | 10 pins | `I2C1_SCL`, `I2C1_SDA`, `NC`, `GND`, `SPI0_SCLK`, `SPI0_MISO`, `SPI0_MOSI`, `SPI0_SS`, `PWM4`, `PWM3` |
| **J3** (Top-Right Outer) | 8 pins | `PWM7`, `PWM6`, `PWM5`, `GPIO15`, `GPIO14`, `GPIO13`, `GPIO12`, `GPIO11` |
| **J2 Outer** (Bottom-Right) | 8 pins | `GPIO10`, `GPIO9`, `GPIO8`, `GPIO7`, `GPIO6`, `GPIO5`, `GPIO4`, `GPIO3` |
| **J2 Inner** (Bottom-Right) | 8 pins | `PWM2`, `PWM1`, `PWM0`, `GPIO2`, `GPIO1`, `GPIO0`, `UART1_TX`, `UART1_RX` |
| **J11** (Top-Left Outer) | 8 pins | `NC`, `IOREF`, `RST`, `3V3`, `5V`, `GND`, `GND`, `VIN` |
| **J9** (Top-Left Inner) | 8 pins | `GPIO31`, `GPIO30`, `GPIO29`, `GPIO28`, `GPIO27`, `GPIO26`, `GPIO25`, `GND` |
| **J10 Outer** (Bottom-Left) | 6 pins | `A0`, `A1`, `A2`, `A3`, `I2C0_SDA`, `I2C0_SCL` |
| **J10 Inner** (Bottom-Left) | 6 pins | `GPIO21`, `GPIO20`, `GPIO19`, `GPIO18`, `GPIO17`, `GPIO16` |
| **J14** (Power Select) | 3 pins | `VIN`, `5V0`, `VCC_USB` |
| **J7** (SPI1 Header) | 6 pins | `SPI1_SS`, `SPI1_SCLK`, `SPI1_MISO`, `GND`, `SPI1_MOSI`, `3V3` |
| **J5** (UART2 Header) | 4 pins | `3V3`, `UART2_TX`, `GND`, `UART2_RX` |
| **J12** (Boot Select) | 2 pins | `BOOT_SEL`, `GND` |

---

### I2C / TwoWire Configuration

The THEJAS32 SoC provides **two hardware I²C controllers**:
- **I²C-1** (Pins `SDA1` / `SCL1` on Header J1): Selected via `TwoWire Wire(1);`
- **I²C-0** (Pins `I2C0_SDA` / `I2C0_SCL` on Header J10 Outer): Selected via `TwoWire Wire(0);`

> **Note:** In Logicraft Studios, if `Wire` is used without an explicit `TwoWire Wire(...)` declaration, the compiler automatically defaults to `TwoWire Wire(1);` so standard Arduino sketches link without `undefined reference to Wire` errors.

---

### Arduino Code Examples

#### 1. Built-in RGB LED & GPIO10 Blink
```cpp
// C-DAC ARIES v3.0 Built-in RGB LED & GPIO10 Blink
// Added: 11-09-2026

#define LED_GREEN 22 // Built-in Green RGB channel (Active-Low)
#define EXT_PIN   10 // External Header J2 Pin 10

void setup() {
  pinMode(LED_GREEN, OUTPUT);
  pinMode(EXT_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_GREEN, LOW);  // Active-low: ON
  digitalWrite(EXT_PIN, HIGH);   // Active-high: ON
  delay(1000);
  digitalWrite(LED_GREEN, HIGH); // Active-low: OFF
  digitalWrite(EXT_PIN, LOW);    // Active-high: OFF
  delay(1000);
}
```

#### 2. OLED SSD1306 Display on I2C-1
```cpp
// C-DAC ARIES v3.0 OLED SSD1306 Test
// Connect OLED: SDA -> SDA1, SCL -> SCL1, VCC -> 3.3V, GND -> GND

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

TwoWire Wire(1); // Select I2C controller 1 (SDA1/SCL1)

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

