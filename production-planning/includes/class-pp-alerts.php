<?php
class PP_Alerts {
	/** Raise an alert; when $dedupe is true an identical open alert for the same request/type is replaced. */
	public static function raise( $level, $type, $message, $request_id = null, $wo_id = null, $department = null, $audience = null, $dedupe = false ) {
		if ( $dedupe ) {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'alerts' ) . ' WHERE type = %s AND request_id = %d AND acknowledged_at IS NULL', $type, (int) $request_id );
		}
		return PP_Db::insert(
			'alerts',
			array( 'level' => $level, 'type' => $type, 'message' => mb_substr( $message, 0, 255 ), 'request_id' => $request_id, 'wo_id' => $wo_id, 'department_code' => $department, 'audience' => $audience, 'created_at' => PP_Db::now() )
		);
	}
}
