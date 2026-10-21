<?php
/**
 * Minimal .xlsx writer (ZipArchive) - one or more sheets of plain values.
 */
class PP_Export {

	public static function xlsx( $sheets, $filename ) {
		$tmp = tempnam( get_temp_dir(), 'pp-export' );
		$zip = new ZipArchive();
		$zip->open( $tmp, ZipArchive::OVERWRITE );
		$zip->addFromString( '[Content_Types].xml', self::content_types( count( $sheets ) ) );
		$zip->addFromString( '_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
		$wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
		$rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
		$i = 0;
		foreach ( $sheets as $name => $rows ) {
			$i++;
			$safe = htmlspecialchars( mb_substr( preg_replace( '/[\[\]\*\?\/\\\\:]/', ' ', $name ), 0, 31 ), ENT_XML1 );
			$wb .= "<sheet name=\"$safe\" sheetId=\"$i\" r:id=\"rId$i\"/>";
			$rels .= "<Relationship Id=\"rId$i\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet$i.xml\"/>";
			$zip->addFromString( "xl/worksheets/sheet$i.xml", self::sheet_xml( $rows ) );
		}
		$wb .= '</sheets></workbook>';
		$rels .= '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
		$zip->addFromString( 'xl/workbook.xml', $wb );
		$zip->addFromString( 'xl/_rels/workbook.xml.rels', $rels );
		$zip->addFromString( 'xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' );
		$zip->close();
		return array( 'path' => $tmp, 'filename' => $filename );
	}

	private static function content_types( $n ) {
		$x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
		for ( $i = 1; $i <= $n; $i++ ) {
			$x .= "<Override PartName=\"/xl/worksheets/sheet$i.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>";
		}
		return $x . '</Types>';
	}

	public static function col_letter( $i ) {
		$s = '';
		$i++;
		while ( $i > 0 ) {
			$m = ( $i - 1 ) % 26;
			$s = chr( 65 + $m ) . $s;
			$i = (int) ( ( $i - $m - 1 ) / 26 );
		}
		return $s;
	}

	private static function sheet_xml( $rows ) {
		$x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
		$r = 0;
		foreach ( $rows as $row ) {
			$r++;
			$x .= "<row r=\"$r\">";
			$c = 0;
			foreach ( (array) $row as $v ) {
				$ref = self::col_letter( $c ) . $r;
				$c++;
				if ( null === $v || '' === $v ) {
					continue;
				}
				$style = 1 === $r ? ' s="1"' : '';
				if ( is_bool( $v ) ) {
					$v = $v ? 'Yes' : 'No';
				}
				if ( is_int( $v ) || is_float( $v ) || ( is_string( $v ) && is_numeric( $v ) && ! preg_match( '/^0\d/', $v ) && strlen( $v ) < 15 ) ) {
					$x .= "<c r=\"$ref\"$style><v>" . ( 0 + $v ) . '</v></c>';
				} else {
					$x .= "<c r=\"$ref\" t=\"inlineStr\"$style><is><t xml:space=\"preserve\">" . htmlspecialchars( (string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8' ) . '</t></is></c>';
				}
			}
			$x .= '</row>';
		}
		return $x . '</sheetData></worksheet>';
	}

	/** Convert a list of assoc arrays to a header + rows table. */
	public static function table( $rows, $columns = null ) {
		if ( ! $rows ) {
			return array( $columns ? array_values( $columns ) : array( 'No data' ) );
		}
		if ( ! $columns ) {
			$columns = array_combine( array_keys( $rows[0] ), array_keys( $rows[0] ) );
		}
		$out = array( array_values( $columns ) );
		foreach ( $rows as $r ) {
			$line = array();
			foreach ( array_keys( $columns ) as $k ) {
				$v = isset( $r[ $k ] ) ? $r[ $k ] : '';
				if ( is_array( $v ) ) {
					$v = wp_json_encode( $v );
				}
				$line[] = $v;
			}
			$out[] = $line;
		}
		return $out;
	}
}
